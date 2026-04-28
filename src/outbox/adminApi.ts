import type { Knex } from "knex";
import { OutboxProducer, OutboxEventRecord } from "./eventProducer.js";
import { OutboxDispatcher } from "./eventDispatcher.js";
import { logger } from "../utils/logger.js";

export interface OutboxAdminStats {
  outbox: {
    pending: number;
    processing: number;
    delivered: number;
    failed: number;
    totalEvents: number;
  };
  deadLetter: {
    total: number;
    byEventType: Array<{ eventType: string; count: number }>;
    byError: Array<{ error: string; count: number }>;
  };
  dispatcher: {
    queueWaiting: number;
    queueActive: number;
    isRunning: boolean;
  };
}

export interface DeadLetterEvent {
  id: string;
  outboxId: string;
  eventType: string;
  aggregateId: string;
  payload: any;
  errorCount: number;
  lastError: string;
  lastAttempt: Date;
  createdAt: Date;
}

export class OutboxAdminApi {
  private outboxProducer: OutboxProducer;

  constructor(
    private db: Knex,
    private dispatcher?: OutboxDispatcher
  ) {
    this.outboxProducer = new OutboxProducer(db);
  }

  /**
   * Get comprehensive outbox statistics
   */
  async getStats(): Promise<OutboxAdminStats> {
    const [outboxStats, deadLetterStats, dispatcherStats] = await Promise.all([
      this.getOutboxStats(),
      this.outboxProducer.getDeadLetterStats(),
      this.dispatcher?.getStats() || {
        queueWaiting: 0,
        queueActive: 0,
      },
    ]);

    return {
      outbox: outboxStats,
      deadLetter: deadLetterStats,
      dispatcher: {
        ...dispatcherStats,
        isRunning: this.dispatcher ? true : false,
      },
    };
  }

  /**
   * Get outbox event statistics
   */
  private async getOutboxStats(): Promise<OutboxAdminStats["outbox"]> {
    const statusCounts = await this.db("outbox_events")
      .select("status")
      .count("* as count")
      .groupBy("status");

    const [totalResult] = await this.db("outbox_events").count("* as count");
    const totalEvents = parseInt(totalResult.count as string);

    const stats = {
      pending: 0,
      processing: 0,
      delivered: 0,
      failed: 0,
      totalEvents,
    };

    statusCounts.forEach(row => {
      const count = parseInt(row.count as string);
      switch (row.status) {
        case "pending":
          stats.pending = count;
          break;
        case "processing":
          stats.processing = count;
          break;
        case "delivered":
          stats.delivered = count;
          break;
        case "failed":
          stats.failed = count;
          break;
      }
    });

    return stats;
  }

  /**
   * Get pending events with pagination
   */
  async getPendingEvents(
    limit = 100,
    offset = 0,
    eventType?: string
  ): Promise<{
    events: OutboxEventRecord[];
    total: number;
    hasMore: boolean;
  }> {
    let query = this.db("outbox_events")
      .select("*")
      .where("status", "pending");

    if (eventType) {
      query = query.where("event_type", eventType);
    }

    const [totalResult] = await query.clone().count("* as count");
    const total = parseInt(totalResult.count as string);

    const events = await query
      .orderBy([
        { column: "aggregate_type", order: "asc" },
        { column: "aggregate_id", order: "asc" },
        { column: "sequence_no", order: "asc" },
      ])
      .limit(limit)
      .offset(offset);

    return {
      events: events.map(this.mapToEventRecord),
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Retry a single failed event
   */
  async retryEvent(eventId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const [event] = await this.db("outbox_events")
        .select("*")
        .where({ id: eventId });

      if (!event) {
        return {
          success: false,
          message: `Event not found: ${eventId}`,
        };
      }

      if (event.status !== "failed") {
        return {
          success: false,
          message: `Event is not in failed state: ${event.status}`,
        };
      }

      // Reset event to pending with retry count reset
      await this.db("outbox_events")
        .where({ id: eventId })
        .update({
          status: "pending",
          retry_count: 0,
          retry_after: new Date(),
          error_message: null,
        });

      logger.info(
        {
          eventId,
          eventType: event.event_type,
          aggregateId: event.aggregate_id,
        },
        "Event manually retried"
      );

      return {
        success: true,
        message: "Event queued for retry",
      };
    } catch (error) {
      logger.error({ eventId, error }, "Failed to retry event");
      return {
        success: false,
        message: `Failed to retry event: ${error.message}`,
      };
    }
  }

  private mapToEventRecord(row: any): OutboxEventRecord {
    return {
      id: row.id.toString(),
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      sequenceNo: row.sequence_no.toString(),
      eventType: row.event_type,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      status: row.status,
      retryCount: row.retry_count,
      retryAfter: row.retry_after,
      deliveredAt: row.delivered_at,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    };
  }

  private mapToDeadLetterEvent(row: any): DeadLetterEvent {
    return {
      id: row.id,
      outboxId: row.outbox_id.toString(),
      eventType: row.event_type,
      aggregateId: row.aggregate_id,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      errorCount: row.error_count,
      lastError: row.last_error,
      lastAttempt: row.last_attempt,
      createdAt: row.created_at,
    };
  }
}