import { getDatabase } from "../database/connection.js";
import { OutboxProducer, type OutboxEventType } from "../outbox/eventProducer.js";
import { auditService } from "./audit.service.js";
import { logger } from "../utils/logger.js";

export type ReplayableEventStatus = "delivered" | "failed";

export interface EventReplayFilter {
  aggregateType?: string;
  aggregateId?: string;
  eventType?: string;
  status?: ReplayableEventStatus;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface EventReplayRun {
  id: string;
  requestedBy: string;
  filter: EventReplayFilter;
  dryRun: boolean;
  reason: string | null;
  status: "pending" | "running" | "completed" | "failed";
  totalMatched: number;
  totalReplayed: number;
  totalSkipped: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface ExecuteReplayInput {
  filter: EventReplayFilter;
  dryRun: boolean;
  requestedBy: string;
  reason?: string;
  confirm?: boolean;
}

// Safety guards: replays are capped, and only terminal events (already delivered
// or failed) can be replayed so we never duplicate in-flight processing.
const MAX_REPLAY_BATCH = 500;
const REPLAYABLE_STATUSES: ReplayableEventStatus[] = ["delivered", "failed"];

export class EventReplayService {
  private db = getDatabase();
  private producer = new OutboxProducer(this.db);

  async previewReplay(filter: EventReplayFilter): Promise<{ totalMatched: number; sample: Record<string, unknown>[] }> {
    const query = this.buildFilterQuery(filter);
    const totalMatched = Number((await query.clone().count("id as count").first())?.count ?? 0);
    const sample = await query.clone().orderBy("created_at", "desc").limit(10);
    return { totalMatched, sample };
  }

  async executeReplay(input: ExecuteReplayInput): Promise<EventReplayRun> {
    const limit = Math.min(input.filter.limit ?? MAX_REPLAY_BATCH, MAX_REPLAY_BATCH);

    if (!input.dryRun && !input.confirm) {
      throw new Error("Replaying events requires confirm=true as an explicit safety guard");
    }

    const [run] = await this.db("event_replay_runs")
      .insert({
        requested_by: input.requestedBy,
        filter: JSON.stringify(input.filter),
        dry_run: input.dryRun,
        reason: input.reason ?? null,
        status: "running",
      })
      .returning("*");

    let runRecord = this.mapRun(run);

    try {
      const events = await this.buildFilterQuery(input.filter)
        .orderBy([
          { column: "aggregate_type", order: "asc" },
          { column: "aggregate_id", order: "asc" },
          { column: "sequence_no", order: "asc" },
        ])
        .limit(limit);

      let replayed = 0;
      let skipped = 0;

      if (!input.dryRun) {
        for (const event of events) {
          try {
            await this.producer.publish({
              aggregateType: event.aggregate_type,
              aggregateId: event.aggregate_id,
              eventType: event.event_type as OutboxEventType,
              payload: typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload,
              metadata: {
                replay: true,
                replayRunId: runRecord.id,
                originalEventId: String(event.id),
                replayReason: input.reason ?? null,
              },
            });
            replayed++;
          } catch (err) {
            skipped++;
            logger.error({ err, eventId: event.id }, "Failed to republish event during replay");
          }
        }
      }

      const [updated] = await this.db("event_replay_runs")
        .where({ id: runRecord.id })
        .update({
          status: "completed",
          total_matched: events.length,
          total_replayed: replayed,
          total_skipped: skipped,
          completed_at: new Date(),
        })
        .returning("*");

      runRecord = this.mapRun(updated);

      await auditService.log({
        action: "event.replay_executed",
        actorId: input.requestedBy,
        actorType: "api_key",
        resourceType: "outbox_event",
        resourceId: runRecord.id,
        metadata: {
          filter: input.filter,
          dryRun: input.dryRun,
          totalMatched: events.length,
          totalReplayed: replayed,
          totalSkipped: skipped,
          reason: input.reason ?? null,
        },
      });

      logger.info(
        { runId: runRecord.id, dryRun: input.dryRun, totalMatched: events.length, replayed, skipped },
        "Event replay run completed"
      );

      return runRecord;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const [failed] = await this.db("event_replay_runs")
        .where({ id: runRecord.id })
        .update({ status: "failed", error_message: message, completed_at: new Date() })
        .returning("*");

      logger.error({ runId: runRecord.id, error: message }, "Event replay run failed");
      return this.mapRun(failed);
    }
  }

  async getReplayRun(id: string): Promise<EventReplayRun | null> {
    const row = await this.db("event_replay_runs").where({ id }).first();
    return row ? this.mapRun(row) : null;
  }

  async listReplayRuns(limit = 50): Promise<EventReplayRun[]> {
    const rows = await this.db("event_replay_runs")
      .orderBy("created_at", "desc")
      .limit(Math.min(limit, 200));
    return rows.map((row) => this.mapRun(row));
  }

  private buildFilterQuery(filter: EventReplayFilter) {
    let query = this.db("outbox_events").whereIn("status", REPLAYABLE_STATUSES);

    if (filter.status) query = query.where("status", filter.status);
    if (filter.aggregateType) query = query.where("aggregate_type", filter.aggregateType);
    if (filter.aggregateId) query = query.where("aggregate_id", filter.aggregateId);
    if (filter.eventType) query = query.where("event_type", filter.eventType);
    if (filter.from) query = query.where("created_at", ">=", filter.from);
    if (filter.to) query = query.where("created_at", "<=", filter.to);

    return query;
  }

  private mapRun(row: Record<string, unknown>): EventReplayRun {
    const filter = typeof row.filter === "string" ? JSON.parse(row.filter) : (row.filter as EventReplayFilter) ?? {};

    return {
      id: String(row.id),
      requestedBy: String(row.requested_by),
      filter,
      dryRun: Boolean(row.dry_run),
      reason: row.reason ? String(row.reason) : null,
      status: row.status as EventReplayRun["status"],
      totalMatched: Number(row.total_matched ?? 0),
      totalReplayed: Number(row.total_replayed ?? 0),
      totalSkipped: Number(row.total_skipped ?? 0),
      errorMessage: row.error_message ? String(row.error_message) : null,
      startedAt: new Date(String(row.started_at)).toISOString(),
      completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }
}

export const eventReplayService = new EventReplayService();
