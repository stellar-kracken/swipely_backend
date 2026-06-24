import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { enrichmentPipelineService } from "./enrichment/index.js";

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "open" | "investigating" | "resolved";

export interface BridgeIncident {
  id: string;
  bridgeId: string;
  assetCode: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string;
  sourceUrl: string | null;
  sourceType: string | null;
  sourceExternalId: string | null;
  sourceRepository: string | null;
  sourceRepoAvatarUrl: string | null;
  sourceActor: string | null;
  sourceAttribution: Record<string, unknown>;
  enrichmentMetadata: Record<string, unknown>;
  enrichmentTags: string[];
  derivedFields: Record<string, unknown>;
  enrichmentValidation: Record<string, unknown>;
  requiresManualReview: boolean;
  ingestionAttemptCount: number;
  lastIngestionError: string | null;
  normalizedFingerprint: string | null;
  followUpActions: string[];
  occurredAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentFilters {
  bridgeId?: string;
  assetCode?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  limit?: number;
  offset?: number;
}

export interface CreateIncidentPayload {
  bridgeId: string;
  assetCode?: string;
  severity: IncidentSeverity;
  title: string;
  description: string;
  sourceUrl?: string;
  sourceType?: string;
  sourceExternalId?: string;
  sourceRepository?: string;
  sourceRepoAvatarUrl?: string;
  sourceActor?: string;
  sourceAttribution?: Record<string, unknown>;
  enrichmentMetadata?: Record<string, unknown>;
  enrichmentTags?: string[];
  derivedFields?: Record<string, unknown>;
  enrichmentValidation?: Record<string, unknown>;
  followUpActions?: string[];
  occurredAt?: string;
}

export interface HeatmapBucket {
  date: string;
  hour: number;
  count: number;
  bySeverity: Record<string, number>;
  incidents: BridgeIncident[];
}

export interface HeatmapData {
  buckets: HeatmapBucket[];
  totalIncidents: number;
  dateRange: { start: string; end: string };
  assets: string[];
}

export type IncidentReplayEventType =
  | "incident_created"
  | "ingestion"
  | "status_change"
  | "enrichment"
  | "resolution";

export interface IncidentReplayEvent {
  id: string;
  timestamp: string;
  eventType: IncidentReplayEventType;
  title: string;
  description: string;
  severity?: IncidentSeverity;
  metadata: Record<string, unknown>;
}

export interface IncidentReplayTimeline {
  incidentId: string;
  incident: BridgeIncident;
  events: IncidentReplayEvent[];
  durationMs: number;
}

export class IncidentService {
  private db = getDatabase();

  async listIncidents(filters: IncidentFilters = {}): Promise<{ incidents: BridgeIncident[]; total: number }> {
    const { bridgeId, assetCode, severity, status, limit = 50, offset = 0 } = filters;

    const baseQuery = this.db("bridge_incidents").where((qb) => {
      if (bridgeId) qb.where("bridge_id", bridgeId);
      if (assetCode) qb.where("asset_code", assetCode);
      if (severity) qb.where("severity", severity);
      if (status) qb.where("status", status);
    });

    const [{ count }] = await baseQuery.clone().count<[{ count: string }]>("id as count");
    const rows = await baseQuery
      .clone()
      .orderBy("occurred_at", "desc")
      .limit(limit)
      .offset(offset)
      .select("*");

    return { incidents: rows.map(this.mapRow), total: Number(count) };
  }

  async getIncident(id: string): Promise<BridgeIncident | null> {
    const row = await this.db("bridge_incidents").where("id", id).first();
    return row ? this.mapRow(row) : null;
  }

  async createIncident(payload: CreateIncidentPayload): Promise<BridgeIncident> {
    const enrichment = await enrichmentPipelineService.enrich({
      recordType: "incident",
      provider: payload.sourceType ?? "manual",
      data: {
        sourceType: payload.sourceType ?? "manual",
        sourceExternalId: payload.sourceExternalId ?? null,
        bridgeId: payload.bridgeId,
        assetCode: payload.assetCode ?? null,
        severity: payload.severity,
        title: payload.title,
        description: payload.description,
        sourceUrl: payload.sourceUrl ?? null,
        occurredAt: payload.occurredAt ?? new Date().toISOString(),
        followUpActions: payload.followUpActions ?? [],
        requiresManualReview: false,
      },
      context: {
        rawMetadata: payload.sourceAttribution ?? {},
      },
    });

    const enrichmentMetadata = {
      ...enrichment.metadata,
      rawMetadata: payload.sourceAttribution ?? {},
    };

    const [row] = await this.db("bridge_incidents")
      .insert({
        bridge_id: payload.bridgeId,
        asset_code: payload.assetCode ?? null,
        severity: payload.severity,
        title: payload.title,
        description: payload.description,
        source_url: payload.sourceUrl ?? null,
        source_type: payload.sourceType ?? null,
        source_external_id: payload.sourceExternalId ?? null,
        source_repository: payload.sourceRepository ?? null,
        source_repo_avatar_url: payload.sourceRepoAvatarUrl ?? null,
        source_actor: payload.sourceActor ?? null,
        source_attribution: JSON.stringify({
          ...(payload.sourceAttribution ?? {}),
          enrichment: {
            metadata: enrichmentMetadata,
            tags: enrichment.tags,
            derivedFields: enrichment.derivedFields,
            validation: enrichment.validation,
            attempts: enrichment.attempts,
          },
        }),
        enrichment_metadata: JSON.stringify(payload.enrichmentMetadata ?? enrichmentMetadata),
        enrichment_tags: payload.enrichmentTags ?? enrichment.tags,
        derived_fields: JSON.stringify(payload.derivedFields ?? enrichment.derivedFields),
        enrichment_validation: JSON.stringify(payload.enrichmentValidation ?? {
          ...enrichment.validation,
          attempts: enrichment.attempts,
        }),
        follow_up_actions: JSON.stringify(payload.followUpActions ?? []),
        occurred_at: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
      })
      .returning("*");

    logger.info({ incidentId: row.id, bridgeId: payload.bridgeId }, "Bridge incident created");
    return this.mapRow(row);
  }

  async updateIncidentStatus(id: string, status: IncidentStatus): Promise<BridgeIncident | null> {
    const update: Record<string, unknown> = { status, updated_at: new Date() };
    if (status === "resolved") {
      update.resolved_at = new Date();
    }
    const [row] = await this.db("bridge_incidents").where("id", id).update(update).returning("*");
    if (!row) return null;
    logger.info({ incidentId: id, status }, "Bridge incident status updated");
    return this.mapRow(row);
  }

  async markRead(incidentId: string, userSession: string): Promise<void> {
    await this.db("bridge_incident_reads")
      .insert({ incident_id: incidentId, user_session: userSession })
      .onConflict(["incident_id", "user_session"])
      .ignore();
  }

  async getUnreadCount(userSession: string): Promise<number> {
    const [{ count }] = await this.db("bridge_incidents as i")
      .leftJoin("bridge_incident_reads as r", function () {
        this.on("r.incident_id", "=", "i.id").andOnVal("r.user_session", "=", userSession);
      })
      .whereNull("r.id")
      .count<[{ count: string }]>("i.id as count");
    return Number(count);
  }

  async getHeatmapData(params: {
    startDate?: string;
    endDate?: string;
    assetSymbol?: string;
  }): Promise<HeatmapData> {
    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(defaultStart.getDate() - 30);

    const startDate = params.startDate ?? defaultStart.toISOString();
    const endDate = params.endDate ?? now.toISOString();

    const filters: IncidentFilters = {
      assetCode: params.assetSymbol,
      limit: 10000,
    };

    const { incidents } = await this.listIncidents(filters);

    const filtered = incidents.filter((inc) => {
      const occurred = new Date(inc.occurredAt);
      if (params.startDate && occurred < new Date(params.startDate)) return false;
      if (params.endDate && occurred > new Date(params.endDate)) return false;
      return true;
    });

    const bucketMap = new Map<string, HeatmapBucket>();
    const assets = new Set<string>();

    for (const incident of filtered) {
      const date = new Date(incident.occurredAt);
      const dateKey = date.toISOString().split("T")[0]!;
      const hour = date.getHours();
      const key = `${dateKey}T${String(hour).padStart(2, "0")}`;

      if (incident.assetCode) assets.add(incident.assetCode);

      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          date: dateKey,
          hour,
          count: 0,
          bySeverity: {},
          incidents: [],
        });
      }

      const bucket = bucketMap.get(key)!;
      bucket.count++;
      bucket.bySeverity[incident.severity] =
        (bucket.bySeverity[incident.severity] ?? 0) + 1;
      bucket.incidents.push(incident);
    }

    const buckets = Array.from(bucketMap.values()).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.hour - b.hour;
    });

    return {
      buckets,
      totalIncidents: filtered.length,
      dateRange: { start: startDate, end: endDate },
      assets: Array.from(assets).sort(),
    };
  }

  async getIncidentReplayTimeline(id: string): Promise<IncidentReplayTimeline | null> {
    const incident = await this.getIncident(id);
    if (!incident) return null;

    const ingestionRows = await this.db("bridge_incident_ingestion_history")
      .where("incident_id", id)
      .orderBy("created_at", "asc")
      .select("*");

    const events: IncidentReplayEvent[] = [];

    events.push({
      id: `${id}-created`,
      timestamp: incident.occurredAt,
      eventType: "incident_created",
      title: "Incident detected",
      description: incident.title,
      severity: incident.severity,
      metadata: {
        bridgeId: incident.bridgeId,
        assetCode: incident.assetCode,
        sourceType: incident.sourceType,
      },
    });

    for (const row of ingestionRows) {
      const payload =
        typeof row.payload === "object" && row.payload !== null
          ? (row.payload as Record<string, unknown>)
          : JSON.parse((row.payload as string) || "{}");

      events.push({
        id: row.id as string,
        timestamp:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
        eventType: "ingestion",
        title: `Ingestion: ${row.event_type}`,
        description: (row.error_message as string | null) ?? `Source ${row.source_type} event processed`,
        metadata: {
          sourceType: row.source_type,
          sourceExternalId: row.source_external_id,
          status: row.status,
          attemptNumber: row.attempt_number,
          payload,
        },
      });
    }

    if (incident.enrichmentTags.length > 0 || Object.keys(incident.enrichmentMetadata).length > 0) {
      events.push({
        id: `${id}-enrichment`,
        timestamp: incident.updatedAt,
        eventType: "enrichment",
        title: "Enrichment applied",
        description: `Tags: ${incident.enrichmentTags.join(", ") || "none"}`,
        metadata: {
          enrichmentMetadata: incident.enrichmentMetadata,
          enrichmentTags: incident.enrichmentTags,
          derivedFields: incident.derivedFields,
        },
      });
    }

    if (incident.status !== "open") {
      events.push({
        id: `${id}-status`,
        timestamp: incident.updatedAt,
        eventType: "status_change",
        title: `Status changed to ${incident.status}`,
        description: `Incident moved to ${incident.status} state`,
        severity: incident.severity,
        metadata: { status: incident.status },
      });
    }

    if (incident.resolvedAt) {
      events.push({
        id: `${id}-resolved`,
        timestamp: incident.resolvedAt,
        eventType: "resolution",
        title: "Incident resolved",
        description: "Incident marked as resolved",
        metadata: { resolvedAt: incident.resolvedAt },
      });
    }

    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const startMs = new Date(events[0]?.timestamp ?? incident.occurredAt).getTime();
    const endMs = new Date(
      events[events.length - 1]?.timestamp ?? incident.updatedAt,
    ).getTime();

    return {
      incidentId: id,
      incident,
      events,
      durationMs: Math.max(0, endMs - startMs),
    };
  }

  mapDatabaseRow(row: Record<string, unknown>): BridgeIncident {
    return this.mapRow(row);
  }

  private mapRow(row: Record<string, unknown>): BridgeIncident {
    return {
      id: row.id as string,
      bridgeId: row.bridge_id as string,
      assetCode: (row.asset_code as string | null) ?? null,
      severity: row.severity as IncidentSeverity,
      status: row.status as IncidentStatus,
      title: row.title as string,
      description: row.description as string,
      sourceUrl: (row.source_url as string | null) ?? null,
      sourceType: (row.source_type as string | null) ?? null,
      sourceExternalId: (row.source_external_id as string | null) ?? null,
      sourceRepository: (row.source_repository as string | null) ?? null,
      sourceRepoAvatarUrl: (row.source_repo_avatar_url as string | null) ?? null,
      sourceActor: (row.source_actor as string | null) ?? null,
      sourceAttribution: typeof row.source_attribution === "object" && row.source_attribution !== null
        ? (row.source_attribution as Record<string, unknown>)
        : JSON.parse((row.source_attribution as string) || "{}"),
      enrichmentMetadata: typeof row.enrichment_metadata === "object" && row.enrichment_metadata !== null
        ? (row.enrichment_metadata as Record<string, unknown>)
        : JSON.parse((row.enrichment_metadata as string) || "{}"),
      enrichmentTags: Array.isArray(row.enrichment_tags)
        ? (row.enrichment_tags as string[])
        : [],
      derivedFields: typeof row.derived_fields === "object" && row.derived_fields !== null
        ? (row.derived_fields as Record<string, unknown>)
        : JSON.parse((row.derived_fields as string) || "{}"),
      enrichmentValidation: typeof row.enrichment_validation === "object" && row.enrichment_validation !== null
        ? (row.enrichment_validation as Record<string, unknown>)
        : JSON.parse((row.enrichment_validation as string) || "{}"),
      requiresManualReview: Boolean(row.requires_manual_review),
      ingestionAttemptCount: Number(row.ingestion_attempt_count ?? 0),
      lastIngestionError: (row.last_ingestion_error as string | null) ?? null,
      normalizedFingerprint: (row.normalized_fingerprint as string | null) ?? null,
      followUpActions: Array.isArray(row.follow_up_actions)
        ? (row.follow_up_actions as string[])
        : JSON.parse((row.follow_up_actions as string) || "[]"),
      occurredAt: row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : String(row.occurred_at),
      resolvedAt: row.resolved_at
        ? (row.resolved_at instanceof Date ? row.resolved_at.toISOString() : String(row.resolved_at))
        : null,
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
      updatedAt: row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
    };
  }
}
