import { getDatabase } from "../database/connection.js";
import { auditService } from "./audit.service.js";
import { logger } from "../utils/logger.js";

export type SourceDecommissionStatus = "deprecated" | "migrating" | "completed" | "rolled_back";

export interface SourceDecommission {
  id: string;
  sourceKey: string;
  replacementSourceKey: string;
  status: SourceDecommissionStatus;
  deprecationPeriodDays: number;
  deprecationStartedAt: string;
  deprecationEndsAt: string;
  fallbackRoutingEnabled: boolean;
  migrationProgressPct: number;
  completionReady: boolean;
  completionVerifiedAt: string | null;
  createdBy: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StartDecommissionInput {
  sourceKey: string;
  replacementSourceKey: string;
  deprecationPeriodDays?: number;
  actorId: string;
  reason?: string;
}

export interface CompletionCheck {
  verified: boolean;
  reasons: string[];
}

const DEFAULT_DEPRECATION_PERIOD_DAYS = 30;

export class SourceDecommissionService {
  private db = getDatabase();

  async startDecommission(input: StartDecommissionInput): Promise<SourceDecommission> {
    if (input.sourceKey === input.replacementSourceKey) {
      throw new Error("Replacement source must differ from the source being decommissioned");
    }

    const existing = await this.getStatus(input.sourceKey);
    if (existing && existing.status !== "rolled_back") {
      throw new Error(`Source "${input.sourceKey}" already has an active decommission (status: ${existing.status})`);
    }

    const periodDays = input.deprecationPeriodDays ?? DEFAULT_DEPRECATION_PERIOD_DAYS;
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + periodDays * 86_400_000);

    const [row] = await this.db("source_decommissions")
      .insert({
        source_key: input.sourceKey,
        replacement_source_key: input.replacementSourceKey,
        status: "deprecated",
        deprecation_period_days: periodDays,
        deprecation_started_at: startedAt,
        deprecation_ends_at: endsAt,
        fallback_routing_enabled: true,
        migration_progress_pct: 0,
        completion_ready: false,
        created_by: input.actorId,
        reason: input.reason ?? null,
      })
      .onConflict("source_key")
      .merge({
        replacement_source_key: input.replacementSourceKey,
        status: "deprecated",
        deprecation_period_days: periodDays,
        deprecation_started_at: startedAt,
        deprecation_ends_at: endsAt,
        fallback_routing_enabled: true,
        migration_progress_pct: 0,
        completion_ready: false,
        completion_verified_at: null,
        created_by: input.actorId,
        reason: input.reason ?? null,
        updated_at: new Date(),
      })
      .returning("*");

    const decommission = this.mapRow(row);

    await auditService.log({
      action: "source.decommission_started",
      actorId: input.actorId,
      actorType: "api_key",
      resourceType: "source",
      resourceId: input.sourceKey,
      after: decommission as unknown as Record<string, unknown>,
      metadata: { replacementSourceKey: input.replacementSourceKey, deprecationPeriodDays: periodDays },
    });

    logger.info({ sourceKey: input.sourceKey, replacementSourceKey: input.replacementSourceKey }, "Source decommission started");
    return decommission;
  }

  async getStatus(sourceKey: string): Promise<SourceDecommission | null> {
    const row = await this.db("source_decommissions").where({ source_key: sourceKey }).first();
    return row ? this.mapRow(row) : null;
  }

  async listDecommissions(): Promise<SourceDecommission[]> {
    const rows = await this.db("source_decommissions").orderBy("created_at", "desc");
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Returns the replacement source key when fallback routing should be used,
   * so callers resolving a data source can transparently redirect traffic
   * away from a source that is being decommissioned.
   */
  async getFallbackSource(sourceKey: string): Promise<string | null> {
    const decommission = await this.getStatus(sourceKey);
    if (!decommission) return null;
    if (decommission.status === "rolled_back" || decommission.status === "completed") return null;
    return decommission.fallbackRoutingEnabled ? decommission.replacementSourceKey : null;
  }

  async updateMigrationProgress(sourceKey: string, progressPct: number, actorId: string): Promise<SourceDecommission> {
    if (progressPct < 0 || progressPct > 100) {
      throw new Error("progressPct must be between 0 and 100");
    }

    const existing = await this.requireActive(sourceKey);

    const completionReady = await this.isEligibleForCompletion(existing, progressPct);

    const [row] = await this.db("source_decommissions")
      .where({ source_key: sourceKey })
      .update({
        status: progressPct >= 100 ? existing.status : "migrating",
        migration_progress_pct: progressPct,
        completion_ready: completionReady,
        updated_at: new Date(),
      })
      .returning("*");

    const updated = this.mapRow(row);

    await auditService.log({
      action: "source.decommission_progress_updated",
      actorId,
      actorType: "api_key",
      resourceType: "source",
      resourceId: sourceKey,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  async checkCompletion(sourceKey: string): Promise<CompletionCheck> {
    const decommission = await this.requireActive(sourceKey);
    const reasons: string[] = [];

    if (decommission.migrationProgressPct < 100) {
      reasons.push(`Data migration is ${decommission.migrationProgressPct}% complete; must reach 100%`);
    }
    if (new Date(decommission.deprecationEndsAt) > new Date()) {
      reasons.push(`Deprecation period has not elapsed (ends ${decommission.deprecationEndsAt})`);
    }

    return { verified: reasons.length === 0, reasons };
  }

  async completeDecommission(sourceKey: string, actorId: string): Promise<SourceDecommission> {
    const existing = await this.requireActive(sourceKey);
    const check = await this.checkCompletion(sourceKey);

    if (!check.verified) {
      throw new Error(`Cannot complete decommission for "${sourceKey}": ${check.reasons.join("; ")}`);
    }

    const [row] = await this.db("source_decommissions")
      .where({ source_key: sourceKey })
      .update({
        status: "completed",
        fallback_routing_enabled: false,
        completion_verified_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    const completed = this.mapRow(row);

    await auditService.log({
      action: "source.decommission_completed",
      actorId,
      actorType: "api_key",
      resourceType: "source",
      resourceId: sourceKey,
      before: existing as unknown as Record<string, unknown>,
      after: completed as unknown as Record<string, unknown>,
    });

    logger.info({ sourceKey }, "Source decommission completed and verified");
    return completed;
  }

  async rollbackDecommission(sourceKey: string, actorId: string, reason?: string): Promise<SourceDecommission> {
    const existing = await this.requireActive(sourceKey);

    const [row] = await this.db("source_decommissions")
      .where({ source_key: sourceKey })
      .update({
        status: "rolled_back",
        fallback_routing_enabled: false,
        completion_ready: false,
        reason: reason ?? existing.reason,
        updated_at: new Date(),
      })
      .returning("*");

    const rolledBack = this.mapRow(row);

    await auditService.log({
      action: "source.decommission_rolled_back",
      actorId,
      actorType: "api_key",
      resourceType: "source",
      resourceId: sourceKey,
      before: existing as unknown as Record<string, unknown>,
      after: rolledBack as unknown as Record<string, unknown>,
      metadata: { reason: reason ?? null },
    });

    logger.warn({ sourceKey, reason }, "Source decommission rolled back");
    return rolledBack;
  }

  /** Periodic sweep used by the scheduled job to flag decommissions ready to complete. */
  async refreshCompletionReadiness(): Promise<number> {
    const active = await this.db("source_decommissions").whereIn("status", ["deprecated", "migrating"]);
    let updated = 0;

    for (const row of active) {
      const decommission = this.mapRow(row);
      const ready = await this.isEligibleForCompletion(decommission, decommission.migrationProgressPct);
      if (ready !== decommission.completionReady) {
        await this.db("source_decommissions").where({ source_key: decommission.sourceKey }).update({ completion_ready: ready });
        updated++;
      }
    }

    return updated;
  }

  private async isEligibleForCompletion(decommission: SourceDecommission, progressPct: number): Promise<boolean> {
    return progressPct >= 100 && new Date(decommission.deprecationEndsAt) <= new Date();
  }

  private async requireActive(sourceKey: string): Promise<SourceDecommission> {
    const existing = await this.getStatus(sourceKey);
    if (!existing) {
      throw new Error(`No decommission found for source "${sourceKey}"`);
    }
    if (existing.status === "completed" || existing.status === "rolled_back") {
      throw new Error(`Decommission for "${sourceKey}" is already ${existing.status}`);
    }
    return existing;
  }

  private mapRow(row: Record<string, unknown>): SourceDecommission {
    return {
      id: String(row.id),
      sourceKey: String(row.source_key),
      replacementSourceKey: String(row.replacement_source_key),
      status: row.status as SourceDecommissionStatus,
      deprecationPeriodDays: Number(row.deprecation_period_days),
      deprecationStartedAt: new Date(String(row.deprecation_started_at)).toISOString(),
      deprecationEndsAt: new Date(String(row.deprecation_ends_at)).toISOString(),
      fallbackRoutingEnabled: Boolean(row.fallback_routing_enabled),
      migrationProgressPct: Number(row.migration_progress_pct),
      completionReady: Boolean(row.completion_ready),
      completionVerifiedAt: row.completion_verified_at ? new Date(String(row.completion_verified_at)).toISOString() : null,
      createdBy: String(row.created_by),
      reason: row.reason ? String(row.reason) : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }
}

export const sourceDecommissionService = new SourceDecommissionService();
