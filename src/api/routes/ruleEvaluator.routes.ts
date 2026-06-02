import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  ruleEvaluatorService,
  type RuleCondition,
  type LogicOperator,
} from "../../services/ruleEvaluator.service.js";

interface EvaluateBody {
  ruleName: string;
  ruleId?: string;
  assetCode: string;
  conditions: RuleCondition[];
  logicOperator: LogicOperator;
  metrics: Record<string, number>;
  previousMetrics?: Record<string, number>;
  previewMode?: boolean;
}

interface EvaluateBatchBody {
  rules: Array<{
    ruleName: string;
    ruleId?: string;
    assetCode: string;
    conditions: RuleCondition[];
    logicOperator: LogicOperator;
  }>;
  metrics: Record<string, number>;
  previousMetrics?: Record<string, number>;
  previewMode?: boolean;
}

interface HistoryQuery {
  ruleId?: string;
  assetCode?: string;
  triggered?: string;
  limit?: string;
  offset?: string;
}

export async function ruleEvaluatorRoutes(server: FastifyInstance) {
  server.post<{ Body: EvaluateBody }>(
    "/evaluate",
    async (request: FastifyRequest<{ Body: EvaluateBody }>, reply: FastifyReply) => {
      try {
        const { ruleName, ruleId, assetCode, conditions, logicOperator, metrics, previousMetrics, previewMode } = request.body;
        const result = ruleEvaluatorService.evaluate(
          { ruleName, ruleId, assetCode, conditions, logicOperator },
          metrics,
          previousMetrics,
          previewMode
        );
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Evaluation failed";
        return reply.code(400).send({ error: message });
      }
    }
  );

  server.post<{ Body: EvaluateBatchBody }>(
    "/evaluate/batch",
    async (request: FastifyRequest<{ Body: EvaluateBatchBody }>, reply: FastifyReply) => {
      try {
        const { rules, metrics, previousMetrics, previewMode } = request.body;
        const results = ruleEvaluatorService.evaluateBatch(
          rules,
          metrics,
          previousMetrics,
          previewMode
        );
        return {
          evaluatedAt: new Date().toISOString(),
          results,
          triggeredCount: results.filter((r) => r.triggered).length,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Batch evaluation failed";
        return reply.code(400).send({ error: message });
      }
    }
  );

  server.get<{ Querystring: HistoryQuery }>(
    "/evaluate/history",
    async (request: FastifyRequest<{ Querystring: HistoryQuery }>) => {
      const { ruleId, assetCode, triggered, limit, offset } = request.query;
      return ruleEvaluatorService.getEvaluationHistory({
        ruleId,
        assetCode,
        triggered: triggered !== undefined ? triggered === "true" : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });
    }
  );
}
