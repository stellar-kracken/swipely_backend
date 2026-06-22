import crypto from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { auditService } from "./audit.service.js";
import type { LogicOperator, RuleCondition } from "./ruleEvaluator.service.js";

// =============================================================================
// TYPES
// =============================================================================

export type AutomationRuleStatus = "active" | "inactive" | "draft";
export type AutomationRuleChangeType = "create" | "update" | "delete" | "activate" | "deactivate";

export interface AutomationRuleAction {
  type: string;
  config: Record<string, unknown>;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  assetCode: string;
  conditions: RuleCondition[];
  logicOperator: LogicOperator;
  actions: AutomationRuleAction[];
  status: AutomationRuleStatus;
  ownerAddress: string;
  cooldownSeconds: number;
  lastExecutedAt: Date | null;
  executionCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAutomationRuleInput {
  name: string;
  description?: string;
  assetCode: string;
  conditions: RuleCondition[];
  logicOperator: LogicOperator;
  actions: AutomationRuleAction[];
  status?: AutomationRuleStatus;
  ownerAddress: string;
  cooldownSeconds?: number;
}

export interface UpdateAutomationRuleInput {
  name?: string;
  description?: string;
  assetCode?: string;
  conditions?: RuleCondition[];
  logicOperator?: LogicOperator;
  actions?: AutomationRuleAction[];
  status?: AutomationRuleStatus;
  cooldownSeconds?: number;
}

export interface AutomationRuleVersion {
  id: string;
  ruleId: string;
  version: number;
  snapshot: Record<string, unknown>;
  changedBy: string;
  changeType: AutomationRuleChangeType;
  changeReason: string | null;
  createdAt: Date;
}

export interface AutomationRuleExecution {
  id: string;
  ruleId: string;
  ruleVersion: number;
  inputMetrics: Record<string, number>;
  conditionResults: Record<string, unknown>[];
  triggered: boolean;
  actionsExecuted: AutomationRuleAction[] | null;
  actionResults: Record<string, unknown>[] | null;
  status: "completed" | "failed" | "partial";
  errorMessage: string | null;
  executedBy: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface RuleHistoryQuery {
  ruleId?: string;
  changedBy?: string;
  changeType?: AutomationRuleChangeType;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface ExecutionHistoryQuery {
  ruleId?: string;
  ruleVersion?: number;
  triggered?: boolean;
  status?: string;
  executedBy?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

// =============================================================================
// AUTOMATION RULES SERVICE
// =============================================================================

export class AutomationRulesService {
  private static instance: AutomationRulesService;

  private constructor() {}

  public static getInstance(): AutomationRulesService {
    if (!AutomationRulesService.instance) {
      AutomationRulesService.instance = new AutomationRulesService();
    }
    return AutomationRulesService.instance;
  }

  // ---------------------------------------------------------------------------
  // RULE CRUD
  // ---------------------------------------------------------------------------

  public async createRule(
    input: CreateAutomationRuleInput,
    actor: { id: string; type?: "user" | "api_key" | "system" }
  ): Promise<AutomationRule> {
    const db = getDatabase();
    const now = new Date();

    const [row] = await db("automation_rules")
      .insert({
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description ?? null,
        asset_code: input.assetCode,
        conditions: JSON.stringify(input.conditions),
        logic_operator: input.logicOperator,
        actions: JSON.stringify(input.actions),
        status: input.status ?? "draft",
        owner_address: input.ownerAddress,
        cooldown_seconds: input.cooldownSeconds ?? 3600,
        last_executed_at: null,
        execution_count: 0,
        version: 1,
        created_at: now,
        updated_at: now,
      })
      .returning("*");

    const rule = this.mapRule(row);

    await this.createVersionSnapshot(rule, actor.id, "create", "Initial rule creation");
    await this.logRuleAudit("alert.rule_created", rule, actor, null, this.ruleToSnapshot(rule));

    logger.info({ ruleId: rule.id, name: rule.name, actorId: actor.id }, "Automation rule created");
    return rule;
  }

  public async getRule(id: string): Promise<AutomationRule | null> {
    const db = getDatabase();
    const row = await db("automation_rules").where({ id }).first();
    return row ? this.mapRule(row) : null;
  }

  public async listRules(params: {
    ownerAddress?: string;
    assetCode?: string;
    status?: AutomationRuleStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ rules: AutomationRule[]; total: number }> {
    const db = getDatabase();
    const limit = Math.min(params.limit ?? 100, 1000);
    const offset = params.offset ?? 0;

    let query = db("automation_rules");
    let countQuery = db("automation_rules");

    if (params.ownerAddress) {
      query = query.where("owner_address", params.ownerAddress);
      countQuery = countQuery.where("owner_address", params.ownerAddress);
    }
    if (params.assetCode) {
      query = query.where("asset_code", params.assetCode);
      countQuery = countQuery.where("asset_code", params.assetCode);
    }
    if (params.status) {
      query = query.where("status", params.status);
      countQuery = countQuery.where("status", params.status);
    }

    const [rows, countResult] = await Promise.all([
      query.orderBy("updated_at", "desc").limit(limit).offset(offset),
      countQuery.count("id as count").first(),
    ]);

    return {
      rules: rows.map((r: Record<string, unknown>) => this.mapRule(r)),
      total: Number(countResult?.count ?? 0),
    };
  }

  public async updateRule(
    id: string,
    input: UpdateAutomationRuleInput,
    actor: { id: string; type?: "user" | "api_key" | "system" },
    changeReason?: string
  ): Promise<AutomationRule | null> {
    const db = getDatabase();
    const existing = await this.getRule(id);
    if (!existing) return null;

    const before = this.ruleToSnapshot(existing);
    const updates: Record<string, unknown> = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.assetCode !== undefined) updates.asset_code = input.assetCode;
    if (input.conditions !== undefined) updates.conditions = JSON.stringify(input.conditions);
    if (input.logicOperator !== undefined) updates.logic_operator = input.logicOperator;
    if (input.actions !== undefined) updates.actions = JSON.stringify(input.actions);
    if (input.status !== undefined) updates.status = input.status;
    if (input.cooldownSeconds !== undefined) updates.cooldown_seconds = input.cooldownSeconds;

    updates.version = existing.version + 1;

    const [row] = await db("automation_rules").where({ id }).update(updates).returning("*");
    const updated = this.mapRule(row);
    const after = this.ruleToSnapshot(updated);

    await this.createVersionSnapshot(
      updated,
      actor.id,
      input.status ? this.statusToChangeType(input.status) : "update",
      changeReason ?? null
    );
    await this.logRuleAudit("alert.rule_updated", updated, actor, before, after);

    logger.info({ ruleId: updated.id, version: updated.version, actorId: actor.id }, "Automation rule updated");
    return updated;
  }

  public async deleteRule(
    id: string,
    actor: { id: string; type?: "user" | "api_key" | "system" },
    changeReason?: string
  ): Promise<boolean> {
    const db = getDatabase();
    const existing = await this.getRule(id);
    if (!existing) return false;

    const before = this.ruleToSnapshot(existing);

    await this.createVersionSnapshot(existing, actor.id, "delete", changeReason ?? null);
    await db("automation_rules").where({ id }).delete();
    await this.logRuleAudit("alert.rule_deleted", existing, actor, before, null);

    logger.info({ ruleId: id, actorId: actor.id }, "Automation rule deleted");
    return true;
  }

  // ---------------------------------------------------------------------------
  // ACTIVATION / DEACTIVATION
  // ---------------------------------------------------------------------------

  public async activateRule(
    id: string,
    actor: { id: string; type?: "user" | "api_key" | "system" },
    changeReason?: string
  ): Promise<AutomationRule | null> {
    return this.updateRule(id, { status: "active" }, actor, changeReason ?? "Rule activated");
  }

  public async deactivateRule(
    id: string,
    actor: { id: string; type?: "user" | "api_key" | "system" },
    changeReason?: string
  ): Promise<AutomationRule | null> {
    return this.updateRule(id, { status: "inactive" }, actor, changeReason ?? "Rule deactivated");
  }

  // ---------------------------------------------------------------------------
  // VERSION HISTORY
  // ---------------------------------------------------------------------------

  public async getRuleHistory(params: RuleHistoryQuery = {}): Promise<{ versions: AutomationRuleVersion[]; total: number }> {
    const db = getDatabase();
    const limit = Math.min(params.limit ?? 100, 1000);
    const offset = params.offset ?? 0;

    let query = db("automation_rule_versions");
    let countQuery = db("automation_rule_versions");

    if (params.ruleId) {
      query = query.where("rule_id", params.ruleId);
      countQuery = countQuery.where("rule_id", params.ruleId);
    }
    if (params.changedBy) {
      query = query.where("changed_by", params.changedBy);
      countQuery = countQuery.where("changed_by", params.changedBy);
    }
    if (params.changeType) {
      query = query.where("change_type", params.changeType);
      countQuery = countQuery.where("change_type", params.changeType);
    }
    if (params.from) {
      query = query.where("created_at", ">=", params.from);
      countQuery = countQuery.where("created_at", ">=", params.from);
    }
    if (params.to) {
      query = query.where("created_at", "<=", params.to);
      countQuery = countQuery.where("created_at", "<=", params.to);
    }

    const [rows, countResult] = await Promise.all([
      query.orderBy("created_at", "desc").limit(limit).offset(offset),
      countQuery.count("id as count").first(),
    ]);

    return {
      versions: rows.map((r: Record<string, unknown>) => this.mapVersion(r)),
      total: Number(countResult?.count ?? 0),
    };
  }

  public async getRuleVersion(ruleId: string, version: number): Promise<AutomationRuleVersion | null> {
    const db = getDatabase();
    const row = await db("automation_rule_versions")
      .where({ rule_id: ruleId, version })
      .first();
    return row ? this.mapVersion(row) : null;
  }

  public async compareVersions(
    ruleId: string,
    fromVersion: number,
    toVersion: number
  ): Promise<{ from: Record<string, unknown>; to: Record<string, unknown>; diff: Record<string, unknown> } | null> {
    const [from, to] = await Promise.all([
      this.getRuleVersion(ruleId, fromVersion),
      this.getRuleVersion(ruleId, toVersion),
    ]);

    if (!from || !to) return null;

    return {
      from: from.snapshot,
      to: to.snapshot,
      diff: this.computeDiff(from.snapshot, to.snapshot),
    };
  }

  // ---------------------------------------------------------------------------
  // EXECUTION HISTORY
  // ---------------------------------------------------------------------------

  public async recordExecution(
    params: Omit<AutomationRuleExecution, "id" | "createdAt">
  ): Promise<AutomationRuleExecution> {
    const db = getDatabase();
    const [row] = await db("automation_rule_executions")
      .insert({
        id: crypto.randomUUID(),
        rule_id: params.ruleId,
        rule_version: params.ruleVersion,
        input_metrics: JSON.stringify(params.inputMetrics),
        condition_results: JSON.stringify(params.conditionResults),
        triggered: params.triggered,
        actions_executed: params.actionsExecuted ? JSON.stringify(params.actionsExecuted) : null,
        action_results: params.actionResults ? JSON.stringify(params.actionResults) : null,
        status: params.status,
        error_message: params.errorMessage,
        executed_by: params.executedBy,
        started_at: params.startedAt,
        completed_at: params.completedAt,
        duration_ms: params.durationMs,
        created_at: new Date(),
      })
      .returning("*");

    // Update rule execution metadata
    await db("automation_rules")
      .where({ id: params.ruleId })
      .update({
        last_executed_at: params.completedAt ?? new Date(),
        execution_count: db.raw("execution_count + 1"),
      });

    return this.mapExecution(row);
  }

  public async getExecutionHistory(
    params: ExecutionHistoryQuery = {}
  ): Promise<{ executions: AutomationRuleExecution[]; total: number }> {
    const db = getDatabase();
    const limit = Math.min(params.limit ?? 100, 1000);
    const offset = params.offset ?? 0;

    let query = db("automation_rule_executions");
    let countQuery = db("automation_rule_executions");

    if (params.ruleId) {
      query = query.where("rule_id", params.ruleId);
      countQuery = countQuery.where("rule_id", params.ruleId);
    }
    if (params.ruleVersion !== undefined) {
      query = query.where("rule_version", params.ruleVersion);
      countQuery = countQuery.where("rule_version", params.ruleVersion);
    }
    if (params.triggered !== undefined) {
      query = query.where("triggered", params.triggered);
      countQuery = countQuery.where("triggered", params.triggered);
    }
    if (params.status) {
      query = query.where("status", params.status);
      countQuery = countQuery.where("status", params.status);
    }
    if (params.executedBy) {
      query = query.where("executed_by", params.executedBy);
      countQuery = countQuery.where("executed_by", params.executedBy);
    }
    if (params.from) {
      query = query.where("created_at", ">=", params.from);
      countQuery = countQuery.where("created_at", ">=", params.from);
    }
    if (params.to) {
      query = query.where("created_at", "<=", params.to);
      countQuery = countQuery.where("created_at", "<=", params.to);
    }

    const [rows, countResult] = await Promise.all([
      query.orderBy("created_at", "desc").limit(limit).offset(offset),
      countQuery.count("id as count").first(),
    ]);

    return {
      executions: rows.map((r: Record<string, unknown>) => this.mapExecution(r)),
      total: Number(countResult?.count ?? 0),
    };
  }

  public async getExecution(id: string): Promise<AutomationRuleExecution | null> {
    const db = getDatabase();
    const row = await db("automation_rule_executions").where({ id }).first();
    return row ? this.mapExecution(row) : null;
  }

  // ---------------------------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------------------------

  public async exportRuleHistoryCsv(params: RuleHistoryQuery = {}): Promise<string> {
    const { versions } = await this.getRuleHistory({ ...params, limit: 10_000, offset: 0 });

    const header = [
      "id", "rule_id", "version", "change_type", "changed_by",
      "change_reason", "created_at",
    ].join(",");

    const rows = versions.map((v) =>
      [
        v.id,
        v.ruleId,
        v.version,
        v.changeType,
        v.changedBy,
        v.changeReason ?? "",
        v.createdAt.toISOString(),
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    );

    return [header, ...rows].join("\n");
  }

  public async exportExecutionHistoryCsv(params: ExecutionHistoryQuery = {}): Promise<string> {
    const { executions } = await this.getExecutionHistory({ ...params, limit: 10_000, offset: 0 });

    const header = [
      "id", "rule_id", "rule_version", "triggered", "status",
      "executed_by", "started_at", "completed_at", "duration_ms", "created_at",
    ].join(",");

    const rows = executions.map((e) =>
      [
        e.id,
        e.ruleId,
        e.ruleVersion,
        e.triggered,
        e.status,
        e.executedBy,
        e.startedAt.toISOString(),
        e.completedAt?.toISOString() ?? "",
        e.durationMs ?? "",
        e.createdAt.toISOString(),
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    );

    return [header, ...rows].join("\n");
  }

  // ---------------------------------------------------------------------------
  // SEARCH
  // ---------------------------------------------------------------------------

  public async searchRuleHistory(params: {
    q?: string;
    ruleId?: string;
    changedBy?: string;
    changeType?: AutomationRuleChangeType;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ versions: AutomationRuleVersion[]; total: number }> {
    const db = getDatabase();
    const limit = Math.min(params.limit ?? 100, 1000);
    const offset = params.offset ?? 0;

    let query = db("automation_rule_versions");
    let countQuery = db("automation_rule_versions");

    if (params.q) {
      const pattern = `%${params.q}%`;
      query = query.where((builder) => {
        builder
          .whereILike("change_reason", pattern)
          .orWhereRaw("snapshot::text ILIKE ?", [pattern]);
      });
      countQuery = countQuery.where((builder) => {
        builder
          .whereILike("change_reason", pattern)
          .orWhereRaw("snapshot::text ILIKE ?", [pattern]);
      });
    }

    if (params.ruleId) {
      query = query.where("rule_id", params.ruleId);
      countQuery = countQuery.where("rule_id", params.ruleId);
    }
    if (params.changedBy) {
      query = query.where("changed_by", params.changedBy);
      countQuery = countQuery.where("changed_by", params.changedBy);
    }
    if (params.changeType) {
      query = query.where("change_type", params.changeType);
      countQuery = countQuery.where("change_type", params.changeType);
    }
    if (params.from) {
      query = query.where("created_at", ">=", params.from);
      countQuery = countQuery.where("created_at", ">=", params.from);
    }
    if (params.to) {
      query = query.where("created_at", "<=", params.to);
      countQuery = countQuery.where("created_at", "<=", params.to);
    }

    const [rows, countResult] = await Promise.all([
      query.orderBy("created_at", "desc").limit(limit).offset(offset),
      countQuery.count("id as count").first(),
    ]);

    return {
      versions: rows.map((r: Record<string, unknown>) => this.mapVersion(r)),
      total: Number(countResult?.count ?? 0),
    };
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private async createVersionSnapshot(
    rule: AutomationRule,
    changedBy: string,
    changeType: AutomationRuleChangeType,
    changeReason: string | null
  ): Promise<void> {
    const db = getDatabase();
    await db("automation_rule_versions").insert({
      id: crypto.randomUUID(),
      rule_id: rule.id,
      version: rule.version,
      snapshot: JSON.stringify(this.ruleToSnapshot(rule)),
      changed_by: changedBy,
      change_type: changeType,
      change_reason: changeReason,
      created_at: new Date(),
    });
  }

  private async logRuleAudit(
    action: "alert.rule_created" | "alert.rule_updated" | "alert.rule_deleted",
    rule: AutomationRule,
    actor: { id: string; type?: "user" | "api_key" | "system" },
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null
  ): Promise<void> {
    await auditService.log({
      action,
      actorId: actor.id,
      actorType: actor.type ?? "user",
      resourceType: "automation_rule",
      resourceId: rule.id,
      before,
      after,
      metadata: {
        ruleName: rule.name,
        assetCode: rule.assetCode,
        version: rule.version,
        status: rule.status,
      },
      severity: action === "alert.rule_deleted" ? "warning" : "info",
    });
  }

  private ruleToSnapshot(rule: AutomationRule): Record<string, unknown> {
    return {
      id: rule.id,
      name: rule.name,
      description: rule.description,
      assetCode: rule.assetCode,
      conditions: rule.conditions,
      logicOperator: rule.logicOperator,
      actions: rule.actions,
      status: rule.status,
      ownerAddress: rule.ownerAddress,
      cooldownSeconds: rule.cooldownSeconds,
      version: rule.version,
    };
  }

  private statusToChangeType(status: AutomationRuleStatus): AutomationRuleChangeType {
    if (status === "active") return "activate";
    if (status === "inactive") return "deactivate";
    return "update";
  }

  private computeDiff(
    from: Record<string, unknown>,
    to: Record<string, unknown>
  ): Record<string, unknown> {
    const diff: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]);

    for (const key of keys) {
      const fromValue = from[key];
      const toValue = to[key];
      if (JSON.stringify(fromValue) !== JSON.stringify(toValue)) {
        diff[key] = { from: fromValue, to: toValue };
      }
    }

    return diff;
  }

  private mapRule(row: Record<string, unknown>): AutomationRule {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      assetCode: row.asset_code as string,
      conditions: this.parseJson(row.conditions, []),
      logicOperator: row.logic_operator as LogicOperator,
      actions: this.parseJson(row.actions, []),
      status: row.status as AutomationRuleStatus,
      ownerAddress: row.owner_address as string,
      cooldownSeconds: row.cooldown_seconds as number,
      lastExecutedAt: (row.last_executed_at as Date | null) ?? null,
      executionCount: Number(row.execution_count ?? 0),
      version: row.version as number,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  private mapVersion(row: Record<string, unknown>): AutomationRuleVersion {
    return {
      id: row.id as string,
      ruleId: row.rule_id as string,
      version: row.version as number,
      snapshot: this.parseJson(row.snapshot, {}),
      changedBy: row.changed_by as string,
      changeType: row.change_type as AutomationRuleChangeType,
      changeReason: (row.change_reason as string | null) ?? null,
      createdAt: row.created_at as Date,
    };
  }

  private mapExecution(row: Record<string, unknown>): AutomationRuleExecution {
    return {
      id: row.id as string,
      ruleId: row.rule_id as string,
      ruleVersion: row.rule_version as number,
      inputMetrics: this.parseJson(row.input_metrics, {}),
      conditionResults: this.parseJson(row.condition_results, []),
      triggered: row.triggered as boolean,
      actionsExecuted: this.parseJson(row.actions_executed, null),
      actionResults: this.parseJson(row.action_results, null),
      status: row.status as "completed" | "failed" | "partial",
      errorMessage: (row.error_message as string | null) ?? null,
      executedBy: row.executed_by as string,
      startedAt: row.started_at as Date,
      completedAt: (row.completed_at as Date | null) ?? null,
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      createdAt: row.created_at as Date,
    };
  }

  private parseJson<T>(value: unknown, defaultValue: T): T {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === "object") return value as T;
    try {
      return JSON.parse(value as string) as T;
    } catch {
      return defaultValue;
    }
  }
}

export const automationRulesService = AutomationRulesService.getInstance();
