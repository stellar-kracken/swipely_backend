import crypto from "node:crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { IncidentService, type IncidentSeverity, type BridgeIncident } from "./incident.service.js";

export type IncidentSourceType = "github" | "webhook" | "partner" | "manual";

export interface RawIncidentPayload {
  sourceType?: IncidentSourceType | string;
  externalId?: string;
  bridgeId?: string;
  assetCode?: string;
  severity?: string;
  title?: string;
  description?: string;
  sourceUrl?: string;
  occurredAt?: string;
  repository?: string;
  repoAvatarUrl?: string;
  actor?: string;
  followUpActions?: string[];
  source?: {
    type?: string;
    externalId?: string;
    repository?: string;
    repoAvatarUrl?: string;
    actor?: string;
    url?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface IngestIncidentResult {
  incident: BridgeIncident | null;
  duplicate: boolean;
  queuedForReview: boolean;
  reviewReason?: string;
}

interface NormalizedIncident {
  sourceType: IncidentSourceType;
  sourceExternalId: string | null;
  bridgeId: string;
  assetCode: string | null;
  severity: IncidentSeverity;
  title: string;
  description: string;
  sourceUrl: string | null;
  followUpActions: string[];
  occurredAt: string;
  sourceRepository: string | null;
  sourceRepoAvatarUrl: string | null;
  sourceActor: string | null;
  sourceAttribution: Record<string, unknown>;
  normalizedFingerprint: string;
  requiresManualReview: boolean;
  reviewReason: string | null;
}

const MANUAL_REVIEW_REASONS = {
  missingBridgeId: "missing_bridge_id",
  missingTitle: "missing_title",
  missingDescription: "missing_description",
} as const;

const SEVERITY_MAP: Record<string, IncidentSeverity> = {
  critical: "critical",
  crit: "critical",
  sev0: "critical",
  severe: "critical",
  high: "high",
  sev1: "high",
  major: "high",
  medium: "medium",
  med: "medium",
  moderate: "medium",
  sev2: "medium",
  low: "low",
  minor: "low",
  info: "low",
  informational: "low",
  sev3: "low",
};

const RETRYABLE_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);

export class IncidentIngestionService {
  private db = getDatabase();
  private incidentService = new IncidentService();

  normalize(raw: RawIncidentPayload): NormalizedIncident {
    const sourceType = this.normalizeSourceType(raw.sourceType ?? raw.source?.type);
    const sourceExternalId = this.normalizeString(raw.externalId ?? raw.source?.externalId);
    const bridgeId = this.normalizeString(raw.bridgeId) ?? "unknown";
    const title = this.normalizeString(raw.title) ?? "Untitled incident";
    const description = this.normalizeString(raw.description) ?? "No description provided.";

    const sourceRepository = this.normalizeString(raw.repository ?? raw.source?.repository);
    const sourceRepoAvatarUrl = this.normalizeString(raw.repoAvatarUrl ?? raw.source?.repoAvatarUrl);
    const sourceActor = this.normalizeString(raw.actor ?? raw.source?.actor);
    const sourceUrl = this.normalizeString(raw.sourceUrl ?? raw.source?.url);

    const severity = this.mapSeverity(raw.severity);
    const occurredAt = this.toIsoDate(raw.occurredAt) ?? new Date().toISOString();
    const followUpActions = Array.isArray(raw.followUpActions) ? raw.followUpActions.filter(Boolean) : [];

    const missing: string[] = [];
    if (!this.normalizeString(raw.bridgeId)) missing.push(MANUAL_REVIEW_REASONS.missingBridgeId);
    if (!this.normalizeString(raw.title)) missing.push(MANUAL_REVIEW_REASONS.missingTitle);
    if (!this.normalizeString(raw.description)) missing.push(MANUAL_REVIEW_REASONS.missingDescription);

    const normalizedFingerprint = this.buildFingerprint({
      sourceType,
      sourceExternalId,
      bridgeId,
      title,
      occurredAt,
      sourceUrl,
    });

    return {
      sourceType,
      sourceExternalId,
      bridgeId,
      assetCode: this.normalizeString(raw.assetCode),
      severity,
      title,
      description,
      sourceUrl,
      followUpActions,
      occurredAt,
      sourceRepository,
      sourceRepoAvatarUrl,
      sourceActor,
      sourceAttribution: {
        sourceType,
        sourceExternalId,
        repository: sourceRepository,
        repoAvatarUrl: sourceRepoAvatarUrl,
        actor: sourceActor,
        sourceUrl,
        metadata: raw.metadata ?? {},
      },
      normalizedFingerprint,
      requiresManualReview: missing.length > 0,
      reviewReason: missing.length > 0 ? missing.join(",") : null,
    };
  }

  async ingest(raw: RawIncidentPayload): Promise<IngestIncidentResult> {
    const normalized = this.normalize(raw);

    if (normalized.requiresManualReview) {
      await this.enqueueReview(normalized, raw);
      await this.recordHistory({
        incidentId: null,
        normalized,
        eventType: "queued_for_review",
        status: "queued",
        errorMessage: normalized.reviewReason,
        attemptNumber: 1,
      });

      return {
        incident: null,
        duplicate: false,
        queuedForReview: true,
        reviewReason: normalized.reviewReason ?? undefined,
      };
    }

    const existing = await this.findDuplicate(normalized);
    if (existing) {
      const existingIncidentId = typeof existing.id === "string" ? existing.id : null;

      await this.recordHistory({
        incidentId: existingIncidentId,
        normalized,
        eventType: "duplicate_detected",
        status: "duplicate",
        attemptNumber: Number((existing as any).ingestion_attempt_count ?? 0) + 1,
      });

      return {
        incident: this.incidentService.mapDatabaseRow(existing as unknown as Record<string, unknown>),
        duplicate: true,
        queuedForReview: false,
      };
    }

    const inserted = await this.createIncidentFromNormalized(normalized);

    await this.recordHistory({
      incidentId: inserted.id,
      normalized,
      eventType: "ingested",
      status: "processed",
      attemptNumber: 1,
    });

    logger.info(
      {
        incidentId: inserted.id,
        sourceType: normalized.sourceType,
        sourceExternalId: normalized.sourceExternalId,
      },
      "Bridge incident ingested"
    );

    return { incident: inserted, duplicate: false, queuedForReview: false };
  }

  async ingestWithRetry(raw: RawIncidentPayload, maxAttempts = 3): Promise<IngestIncidentResult> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await this.ingest(raw);
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error) || attempt >= maxAttempts) {
          const normalized = this.normalize(raw);
          await this.recordHistory({
            incidentId: null,
            normalized,
            eventType: "ingestion_failed",
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown ingestion error",
            attemptNumber: attempt,
          });
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Unknown ingestion failure");
  }

  async listManualReviewQueue(limit = 50): Promise<unknown[]> {
    return this.db("bridge_incident_review_queue")
      .where("status", "pending")
      .orderBy("created_at", "asc")
      .limit(limit)
      .select("*");
  }

  private async findDuplicate(normalized: NormalizedIncident): Promise<Record<string, unknown> | null> {
    const byFingerprint = await this.db("bridge_incidents")
      .where("normalized_fingerprint", normalized.normalizedFingerprint)
      .first();

    if (byFingerprint) return byFingerprint as Record<string, unknown>;

    if (normalized.sourceExternalId) {
      const byExternalId = await this.db("bridge_incidents")
        .where({
          source_type: normalized.sourceType,
          source_external_id: normalized.sourceExternalId,
        })
        .first();

      if (byExternalId) return byExternalId as Record<string, unknown>;
    }

    return null;
  }

  private async createIncidentFromNormalized(normalized: NormalizedIncident): Promise<BridgeIncident> {
    const [row] = await this.db("bridge_incidents")
      .insert({
        bridge_id: normalized.bridgeId,
        asset_code: normalized.assetCode,
        severity: normalized.severity,
        title: normalized.title,
        description: normalized.description,
        source_url: normalized.sourceUrl,
        follow_up_actions: JSON.stringify(normalized.followUpActions),
        occurred_at: new Date(normalized.occurredAt),
        source_type: normalized.sourceType,
        source_external_id: normalized.sourceExternalId,
        source_repository: normalized.sourceRepository,
        source_repo_avatar_url: normalized.sourceRepoAvatarUrl,
        source_actor: normalized.sourceActor,
        source_attribution: JSON.stringify(normalized.sourceAttribution),
        normalized_fingerprint: normalized.normalizedFingerprint,
        requires_manual_review: false,
        ingestion_attempt_count: 1,
        last_ingestion_error: null,
      })
      .returning("*");

    return this.incidentService.mapDatabaseRow(row as unknown as Record<string, unknown>);
  }

  private async enqueueReview(normalized: NormalizedIncident, raw: RawIncidentPayload): Promise<void> {
    await this.db("bridge_incident_review_queue").insert({
      source_type: normalized.sourceType,
      source_external_id: normalized.sourceExternalId,
      raw_payload: JSON.stringify(raw),
      reason: normalized.reviewReason,
      status: "pending",
      incident_id: null,
    });
  }

  private async recordHistory(input: {
    incidentId: string | null;
    normalized: NormalizedIncident;
    eventType: string;
    status: string;
    errorMessage?: string | null;
    attemptNumber: number;
  }): Promise<void> {
    await this.db("bridge_incident_ingestion_history").insert({
      incident_id: input.incidentId,
      source_type: input.normalized.sourceType,
      source_external_id: input.normalized.sourceExternalId,
      event_type: input.eventType,
      payload: JSON.stringify(input.normalized.sourceAttribution),
      status: input.status,
      error_message: input.errorMessage ?? null,
      attempt_number: input.attemptNumber,
    });
  }

  private mapSeverity(sourceSeverity: string | undefined): IncidentSeverity {
    const key = this.normalizeString(sourceSeverity)?.toLowerCase();
    if (!key) return "medium";
    return SEVERITY_MAP[key] ?? "medium";
  }

  private normalizeSourceType(value: string | undefined): IncidentSourceType {
    const normalized = this.normalizeString(value)?.toLowerCase();
    if (normalized === "github" || normalized === "partner" || normalized === "manual") {
      return normalized;
    }
    return "webhook";
  }

  private normalizeString(value: string | undefined | null): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toIsoDate(value: string | undefined): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  private buildFingerprint(input: {
    sourceType: IncidentSourceType;
    sourceExternalId: string | null;
    bridgeId: string;
    title: string;
    occurredAt: string;
    sourceUrl: string | null;
  }): string {
    const material = [
      input.sourceType,
      input.sourceExternalId ?? "",
      input.bridgeId,
      input.title.toLowerCase(),
      input.occurredAt,
      input.sourceUrl ?? "",
    ].join("|");

    return crypto.createHash("sha256").update(material).digest("hex");
  }

  private isRetryable(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const err = error as { code?: string };
    return typeof err.code === "string" && RETRYABLE_ERROR_CODES.has(err.code);
  }
}
