import crypto from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export type ThresholdOperator =
  | "gt" | "gte" | "lt" | "lte" | "eq" | "ne" | "between" | "changes_by_pct";

export type LogicOperator = "AND" | "OR";

export interface RuleEvaluationInput {
  ruleId?: string;
  ruleName: string;
  assetCode: string;
  conditions: RuleCondition[];
  logicOperator: LogicOperator;
}

export interface RuleCondition {
  field: string;
  operator: ThresholdOperator;
  value: number;
  valueHigh?: number;
  label?: string;
}

export interface ConditionResult {
  field: string;
  operator: ThresholdOperator;
  expectedValue: number;
  actualValue: number;
  passed: boolean;
  label?: string;
}

export interface RuleEvaluationOutput {
  id: string;
  ruleId: string | null;
  ruleName: string;
  assetCode: string;
  triggered: boolean;
  logicOperator: LogicOperator;
  conditionResults: ConditionResult[];
  previewMode: boolean;
  evaluatedAt: string;
  executedBy?: string;
  executionContext?: string;
}

export interface EvaluationOptions {
  previewMode?: boolean;
  executedBy?: string;
  executionContext?: string;
}

function evaluateCondition(
  condition: RuleCondition,
  actualValue: number,
  previousValue?: number
): boolean {
  const { operator, value, valueHigh } = condition;
  switch (operator) {
    case "gt":   return actualValue > value;
    case "gte":  return actualValue >= value;
    case "lt":   return actualValue < value;
    case "lte":  return actualValue <= value;
    case "eq":   return actualValue === value;
    case "ne":   return actualValue !== value;
    case "between":
      return valueHigh !== undefined && actualValue >= value && actualValue <= valueHigh;
    case "changes_by_pct":
      if (previousValue === undefined || previousValue === 0) return false;
      return Math.abs((actualValue - previousValue) / previousValue) * 100 >= value;
    default:
      return false;
  }
}

export class RuleEvaluatorService {
  private static instance: RuleEvaluatorService;

  private constructor() {}

  public static getInstance(): RuleEvaluatorService {
    if (!RuleEvaluatorService.instance) {
      RuleEvaluatorService.instance = new RuleEvaluatorService();
    }
    return RuleEvaluatorService.instance;
  }

  public evaluate(
    input: RuleEvaluationInput,
    metrics: Record<string, number>,
    previousMetrics?: Record<string, number>,
    options: boolean | EvaluationOptions = false
  ): RuleEvaluationOutput {
    const opts: EvaluationOptions = typeof options === "boolean" ? { previewMode: options } : options;
    this.validateConditions(input.conditions);

    const conditionResults: ConditionResult[] = input.conditions.map((cond) => {
      const actualValue = metrics[cond.field] ?? 0;
      const prevValue = previousMetrics?.[cond.field];
      const passed = evaluateCondition(cond, actualValue, prevValue);
      return {
        field: cond.field,
        operator: cond.operator,
        expectedValue: cond.value,
        actualValue,
        passed,
        label: cond.label,
      };
    });

    const triggered =
      input.logicOperator === "AND"
        ? conditionResults.every((r) => r.passed)
        : conditionResults.some((r) => r.passed);

    const result: RuleEvaluationOutput = {
      id: crypto.randomUUID(),
      ruleId: input.ruleId ?? null,
      ruleName: input.ruleName,
      assetCode: input.assetCode,
      triggered,
      logicOperator: input.logicOperator,
      conditionResults,
      previewMode: opts.previewMode ?? false,
      evaluatedAt: new Date().toISOString(),
      executedBy: opts.executedBy ?? "system",
      executionContext: opts.executionContext ?? "api",
    };

    if (!result.previewMode) {
      this.persistEvaluationLog(result, metrics, opts.executedBy, opts.executionContext).catch((err) =>
        logger.error({ err }, "Failed to persist rule evaluation log")
      );
    }

    return result;
  }

  public evaluateBatch(
    inputs: RuleEvaluationInput[],
    metrics: Record<string, number>,
    previousMetrics?: Record<string, number>,
    options: boolean | EvaluationOptions = false
  ): RuleEvaluationOutput[] {
    const opts: EvaluationOptions = typeof options === "boolean" ? { previewMode: options } : options;
    return inputs.map((input) =>
      this.evaluate(input, metrics, previousMetrics, opts)
    );
  }

  public async getEvaluationHistory(params: {
    ruleId?: string;
    assetCode?: string;
    triggered?: boolean;
    executedBy?: string;
    executionContext?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ evaluations: RuleEvaluationOutput[]; total: number }> {
    const db = getDatabase();
    const limit = Math.min(params.limit ?? 100, 1000);
    const offset = params.offset ?? 0;

    let query = db("rule_evaluator_logs");
    let countQuery = db("rule_evaluator_logs");

    if (params.ruleId) {
      query = query.where("rule_id", params.ruleId);
      countQuery = countQuery.where("rule_id", params.ruleId);
    }
    if (params.assetCode) {
      query = query.where("asset_code", params.assetCode);
      countQuery = countQuery.where("asset_code", params.assetCode);
    }
    if (params.triggered !== undefined) {
      query = query.where("triggered", params.triggered);
      countQuery = countQuery.where("triggered", params.triggered);
    }
    if (params.executedBy) {
      query = query.where("executed_by", params.executedBy);
      countQuery = countQuery.where("executed_by", params.executedBy);
    }
    if (params.executionContext) {
      query = query.where("execution_context", params.executionContext);
      countQuery = countQuery.where("execution_context", params.executionContext);
    }
    if (params.from) {
      query = query.where("evaluated_at", ">=", params.from);
      countQuery = countQuery.where("evaluated_at", ">=", params.from);
    }
    if (params.to) {
      query = query.where("evaluated_at", "<=", params.to);
      countQuery = countQuery.where("evaluated_at", "<=", params.to);
    }

    const [rows, countResult] = await Promise.all([
      query.orderBy("evaluated_at", "desc").limit(limit).offset(offset),
      countQuery.count("id as count").first(),
    ]);

    return {
      evaluations: rows.map((r: Record<string, unknown>) => this.mapRow(r)),
      total: Number(countResult?.count ?? 0),
    };
  }

  private validateConditions(conditions: RuleCondition[]): void {
    if (!conditions.length) {
      throw new Error("At least one condition is required");
    }
    for (const cond of conditions) {
      if (!cond.field?.trim()) throw new Error("Condition field cannot be empty");
      if (cond.operator === "between" && cond.valueHigh === undefined) {
        throw new Error('Condition with "between" operator requires valueHigh');
      }
    }
  }

  private async persistEvaluationLog(
    result: RuleEvaluationOutput,
    metrics: Record<string, number>,
    executedBy?: string,
    executionContext?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const db = getDatabase();
    await db("rule_evaluator_logs").insert({
      id: result.id,
      rule_id: result.ruleId,
      rule_name: result.ruleName,
      asset_code: result.assetCode,
      input_metrics: JSON.stringify(metrics),
      evaluation_result: JSON.stringify(result),
      triggered: result.triggered,
      logic_operator: result.logicOperator,
      preview_mode: result.previewMode,
      executed_by: executedBy ?? "system",
      execution_context: executionContext ?? "api",
      metadata: metadata ? JSON.stringify(metadata) : "{}",
      evaluated_at: new Date(),
    });
  }

  private mapRow(row: Record<string, unknown>): RuleEvaluationOutput {
    const evaluationResult =
      typeof row.evaluation_result === "string"
        ? JSON.parse(row.evaluation_result as string)
        : row.evaluation_result;
    return {
      id: row.id as string,
      ruleId: row.rule_id as string | null,
      ruleName: row.rule_name as string,
      assetCode: row.asset_code as string,
      triggered: row.triggered as boolean,
      logicOperator: row.logic_operator as LogicOperator,
      conditionResults: evaluationResult?.conditionResults ?? [],
      previewMode: row.preview_mode as boolean,
      evaluatedAt: (row.evaluated_at as Date).toISOString(),
      executedBy: (row.executed_by as string) ?? "system",
      executionContext: (row.execution_context as string) ?? "api",
    };
  }
}

export const ruleEvaluatorService = RuleEvaluatorService.getInstance();
