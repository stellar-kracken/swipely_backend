import { randomBytes } from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export interface FeatureFlagAuditEntry {
  id: string;
  flagName: string;
  environment: string;
  action: "create" | "update" | "delete";
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  changedBy: string;
  changeReason: string | null;
  timestamp: string;
}

export interface FeatureFlagAuditQuery {
  flagName?: string;
  environment?: string;
  changedBy?: string;
  action?: "create" | "update" | "delete";
  from?: Date;
  to?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}

export class FeatureFlagAuditService {
  private db = getDatabase();

  async recordChange(params: {
    flagName: string;
    environment: string;
    action: "create" | "update" | "delete";
    oldValue: Record<string, unknown> | null;
    newValue: Record<string, unknown> | null;
    changedBy: string;
    changeReason?: string;
  }): Promise<void> {
    try {
      await this.db("feature_flag_audit_logs").insert({
        id: randomBytes(16).toString("hex"),
        flag_name: params.flagName,
        environment: params.environment,
        action: params.action,
        old_value: params.oldValue ? JSON.stringify(params.oldValue) : null,
        new_value: params.newValue ? JSON.stringify(params.newValue) : null,
        changed_by: params.changedBy,
        change_reason: params.changeReason ?? null,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error({ error, flagName: params.flagName }, "Failed to record feature flag audit");
    }
  }

  async search(query: FeatureFlagAuditQuery = {}): Promise<{
    entries: FeatureFlagAuditEntry[];
    total: number;
  }> {
    const limit = Math.min(query.limit ?? 100, 500);
    const offset = query.offset ?? 0;

    let base = this.db("feature_flag_audit_logs");

    if (query.flagName) base = base.where("flag_name", query.flagName);
    if (query.environment) base = base.where("environment", query.environment);
    if (query.changedBy) base = base.where("changed_by", query.changedBy);
    if (query.action) base = base.where("action", query.action);
    if (query.from) base = base.where("timestamp", ">=", query.from);
    if (query.to) base = base.where("timestamp", "<=", query.to);
    if (query.search) {
      const term = `%${query.search}%`;
      base = base.where((qb) => {
        qb.whereILike("flag_name", term)
          .orWhereILike("changed_by", term)
          .orWhereILike("change_reason", term);
      });
    }

    const countResult = await base.clone().count("* as count").first();
    const total = Number((countResult as { count?: string | number })?.count ?? 0);

    const rows = await base
      .orderBy("timestamp", "desc")
      .limit(limit)
      .offset(offset);

    return {
      entries: rows.map((row) => this.mapRow(row)),
      total,
    };
  }

  async export(query: FeatureFlagAuditQuery = {}): Promise<FeatureFlagAuditEntry[]> {
    const { entries } = await this.search({ ...query, limit: 500 });
    return entries;
  }

  private mapRow(row: Record<string, unknown>): FeatureFlagAuditEntry {
    return {
      id: String(row.id),
      flagName: String(row.flag_name),
      environment: String(row.environment),
      action: row.action as FeatureFlagAuditEntry["action"],
      oldValue: row.old_value ? JSON.parse(String(row.old_value)) : null,
      newValue: row.new_value ? JSON.parse(String(row.new_value)) : null,
      changedBy: String(row.changed_by),
      changeReason: row.change_reason ? String(row.change_reason) : null,
      timestamp:
        row.timestamp instanceof Date
          ? row.timestamp.toISOString()
          : String(row.timestamp),
    };
  }
}

export const featureFlagAuditService = new FeatureFlagAuditService();
