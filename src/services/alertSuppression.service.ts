import crypto from "crypto";
import { z } from "zod";
import { getDatabase } from "../database/connection.js";
import type { AlertPriority, AlertType } from "./alert.service.js";

export interface SuppressionContext {
  assetCode: string;
  alertType: AlertType;
  priority: AlertPriority;
  source: string;
  at?: Date;
}

export interface SuppressionRule {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  assetCodes: string[];
  alertTypes: AlertType[];
  priorities: AlertPriority[];
  sources: string[];
  daysOfWeek: number[];
  windowStart: Date | null;
  windowEnd: Date | null;
  maintenanceMode: boolean;
  expiresAt: Date | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SuppressionDecision {
  suppressed: boolean;
  matchedRule: Pick<SuppressionRule, "id" | "name" | "maintenanceMode" | "expiresAt"> | null;
  reason: string | null;
}

const listOfDaysSchema = z.array(z.number().int().min(0).max(6)).max(7);

const windowRefinement = (value: { windowStart?: Date; windowEnd?: Date; expiresAt?: Date }, ctx: z.RefinementCtx) => {
  if (value.windowStart && value.windowEnd && value.windowEnd <= value.windowStart) {
    ctx.addIssue({ code: "custom", message: "windowEnd must be later than windowStart", path: ["windowEnd"] });
  }
  if (value.expiresAt && value.windowStart && value.expiresAt <= value.windowStart) {
    ctx.addIssue({ code: "custom", message: "expiresAt must be later than windowStart", path: ["expiresAt"] });
  }
};

const suppressionRuleBaseSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  assetCodes: z.array(z.string().min(1).max(20)).max(100).optional(),
  alertTypes: z
    .array(
      z.enum([
        "price_deviation",
        "supply_mismatch",
        "bridge_downtime",
        "health_score_drop",
        "volume_anomaly",
        "reserve_ratio_breach",
      ])
    )
    .max(20)
    .optional(),
  priorities: z.array(z.enum(["critical", "high", "medium", "low"])).max(4).optional(),
  sources: z.array(z.string().min(1).max(100)).max(100).optional(),
  daysOfWeek: listOfDaysSchema.optional(),
  windowStart: z.coerce.date().optional(),
  windowEnd: z.coerce.date().optional(),
  maintenanceMode: z.boolean().optional(),
  expiresAt: z.coerce.date().optional(),
  actor: z.string().min(1).max(120),
});

export const createSuppressionRuleSchema = suppressionRuleBaseSchema.superRefine(windowRefinement);

export const updateSuppressionRuleSchema = suppressionRuleBaseSchema
  .omit({ name: true, actor: true })
  .extend({
    name: z.string().min(3).max(120).optional(),
    actor: z.string().min(1).max(120),
  })
  .partial()
  .required({ actor: true })
  .superRefine(windowRefinement);

export class AlertSuppressionService {
  private static instance: AlertSuppressionService;

  public static getInstance(): AlertSuppressionService {
    if (!AlertSuppressionService.instance) {
      AlertSuppressionService.instance = new AlertSuppressionService();
    }
    return AlertSuppressionService.instance;
  }

  public async listRules(includeExpired = false): Promise<SuppressionRule[]> {
    const db = getDatabase();
    let query = db("alert_suppression_rules").orderBy("created_at", "desc");
    if (!includeExpired) {
      query = query.where((builder: any) => {
        builder.whereNull("expires_at").orWhere("expires_at", ">", new Date());
      });
    }
    const rows = await query;
    return rows.map((row: Record<string, unknown>) => this.mapRule(row));
  }

  public async createRule(payload: z.infer<typeof createSuppressionRuleSchema>): Promise<SuppressionRule> {
    const data = createSuppressionRuleSchema.parse(payload);
    const db = getDatabase();

    const [row] = await db("alert_suppression_rules")
      .insert({
        id: crypto.randomUUID(),
        name: data.name,
        description: data.description ?? null,
        is_active: data.isActive ?? true,
        asset_codes: JSON.stringify(data.assetCodes ?? []),
        alert_types: JSON.stringify(data.alertTypes ?? []),
        priorities: JSON.stringify(data.priorities ?? []),
        sources: JSON.stringify(data.sources ?? []),
        days_of_week: JSON.stringify(data.daysOfWeek ?? []),
        window_start: data.windowStart ?? null,
        window_end: data.windowEnd ?? null,
        maintenance_mode: data.maintenanceMode ?? false,
        expires_at: data.expiresAt ?? null,
        created_by: data.actor,
        updated_by: data.actor,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    await this.writeAudit({
      action: "created",
      actor: data.actor,
      ruleId: row.id as string,
      details: { name: data.name },
    });

    return this.mapRule(row);
  }

  public async updateRule(ruleId: string, payload: z.infer<typeof updateSuppressionRuleSchema>): Promise<SuppressionRule | null> {
    const data = updateSuppressionRuleSchema.parse(payload);
    const db = getDatabase();

    const patch: Record<string, unknown> = {
      updated_by: data.actor,
      updated_at: new Date(),
    };

    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.isActive !== undefined) patch.is_active = data.isActive;
    if (data.assetCodes !== undefined) patch.asset_codes = JSON.stringify(data.assetCodes);
    if (data.alertTypes !== undefined) patch.alert_types = JSON.stringify(data.alertTypes);
    if (data.priorities !== undefined) patch.priorities = JSON.stringify(data.priorities);
    if (data.sources !== undefined) patch.sources = JSON.stringify(data.sources);
    if (data.daysOfWeek !== undefined) patch.days_of_week = JSON.stringify(data.daysOfWeek);
    if (data.windowStart !== undefined) patch.window_start = data.windowStart ?? null;
    if (data.windowEnd !== undefined) patch.window_end = data.windowEnd ?? null;
    if (data.maintenanceMode !== undefined) patch.maintenance_mode = data.maintenanceMode;
    if (data.expiresAt !== undefined) patch.expires_at = data.expiresAt ?? null;

    const [row] = await db("alert_suppression_rules").where({ id: ruleId }).update(patch).returning("*");
    if (!row) return null;

    await this.writeAudit({
      action: "updated",
      actor: data.actor,
      ruleId,
      details: { patch: Object.keys(patch) },
    });

    return this.mapRule(row);
  }

  public async deleteRule(ruleId: string, actor: string): Promise<boolean> {
    const db = getDatabase();
    const deleted = await db("alert_suppression_rules").where({ id: ruleId }).delete();
    if (deleted > 0) {
      await this.writeAudit({ action: "deleted", actor, ruleId, details: {} });
      return true;
    }
    return false;
  }

  public async shouldSuppress(context: SuppressionContext): Promise<SuppressionDecision> {
    const now = context.at ?? new Date();
    const rules = await this.listRules(false);

    for (const rule of rules) {
      if (!this.isRuleEffective(rule, now)) continue;
      if (!this.matchesRule(rule, context)) continue;

      await this.writeAudit({
        action: "suppressed",
        actor: "system",
        ruleId: rule.id,
        details: {
          assetCode: context.assetCode,
          alertType: context.alertType,
          priority: context.priority,
          source: context.source,
          at: now.toISOString(),
        },
      });

      return {
        suppressed: true,
        matchedRule: {
          id: rule.id,
          name: rule.name,
          maintenanceMode: rule.maintenanceMode,
          expiresAt: rule.expiresAt,
        },
        reason: rule.maintenanceMode ? "Maintenance override active" : "Suppression rule matched",
      };
    }

    return { suppressed: false, matchedRule: null, reason: null };
  }

  public async preview(context: SuppressionContext, actor: string): Promise<SuppressionDecision> {
    const decision = await this.shouldSuppress(context);
    await this.writeAudit({
      action: "preview",
      actor,
      ruleId: decision.matchedRule?.id ?? null,
      details: {
        context,
        decision,
      },
    });
    return decision;
  }

  public async getAuditHistory(limit = 100): Promise<Array<Record<string, unknown>>> {
    const db = getDatabase();
    return db("alert_suppression_audit").orderBy("created_at", "desc").limit(limit);
  }

  private isRuleEffective(rule: SuppressionRule, at: Date): boolean {
    if (!rule.isActive) return false;
    if (rule.expiresAt && rule.expiresAt <= at) return false;
    if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(at.getUTCDay())) return false;
    if (rule.windowStart && at < rule.windowStart) return false;
    if (rule.windowEnd && at > rule.windowEnd) return false;
    return true;
  }

  private matchesRule(rule: SuppressionRule, context: SuppressionContext): boolean {
    const matchList = <T extends string>(candidate: T, list: T[]) => list.length === 0 || list.includes(candidate);

    return (
      matchList(context.assetCode, rule.assetCodes) &&
      matchList(context.alertType, rule.alertTypes) &&
      matchList(context.priority, rule.priorities) &&
      matchList(context.source, rule.sources)
    );
  }

  private async writeAudit(payload: {
    action: string;
    actor: string;
    ruleId: string | null;
    details: Record<string, unknown>;
  }): Promise<void> {
    const db = getDatabase();
    await db("alert_suppression_audit").insert({
      id: crypto.randomUUID(),
      rule_id: payload.ruleId,
      action: payload.action,
      actor: payload.actor,
      details: JSON.stringify(payload.details),
      created_at: new Date(),
    });
  }

  private mapRule(row: Record<string, unknown>): SuppressionRule {
    const parseJsonArray = <T>(value: unknown): T[] => {
      if (!value) return [];
      if (Array.isArray(value)) return value as T[];
      if (typeof value === "string") return JSON.parse(value) as T[];
      return [];
    };

    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      isActive: Boolean(row.is_active),
      assetCodes: parseJsonArray<string>(row.asset_codes),
      alertTypes: parseJsonArray<AlertType>(row.alert_types),
      priorities: parseJsonArray<AlertPriority>(row.priorities),
      sources: parseJsonArray<string>(row.sources),
      daysOfWeek: parseJsonArray<number>(row.days_of_week),
      windowStart: row.window_start ? new Date(row.window_start as string) : null,
      windowEnd: row.window_end ? new Date(row.window_end as string) : null,
      maintenanceMode: Boolean(row.maintenance_mode),
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
      createdBy: row.created_by as string,
      updatedBy: row.updated_by as string,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

export const alertSuppressionService = AlertSuppressionService.getInstance();
