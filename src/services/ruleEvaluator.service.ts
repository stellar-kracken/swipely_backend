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
    previewMode = false
  ): RuleEvaluationOutput {
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
      previewMode,
      evaluatedAt: new Date().toISOString(),
    };

    if (!previewMode) {
      this.persistEvaluationLog(result, metrics).catch((err) =>
        logger.error({ err }, "Failed to persist rule evaluation log")
      );
    }

    return result;
  }

  public evaluateBatch(
    inputs: RuleEvaluationInput[],
    metrics: Record<string, number>,
    previousMetrics?: Record<string, number>,
    previewMode = false
  ): RuleEvaluationOutput[] {
    return inputs.map((input) =>
      this.evaluate(input, metrics, previousMetrics, previewMode)
    );
  }

  public async getEvaluationHistory(params: {
    ruleId?: string;
    assetCode?: string;
    triggered?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<RuleEvaluationOutput[]> {
    const db = getDatabase();
    let query = db("rule_evaluator_logs").orderBy("evaluated_at", "desc");

    if (params.ruleId) query = query.where("rule_id", params.ruleId);
    if (params.assetCode) query = query.where("asset_code", params.assetCode);
    if (params.triggered !== undefined) query = query.where("triggered", params.triggered);
    if (params.limit) query = query.limit(params.limit);
    if (params.offset) query = query.offset(params.offset);

    const rows = await query;
    return rows.map((r: Record<string, unknown>) => this.mapRow(r));
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
    metrics: Record<string, number>
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
    };
  }
}

export const ruleEvaluatorService = RuleEvaluatorService.getInstance();
