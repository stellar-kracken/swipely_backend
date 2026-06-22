import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import "@fastify/rate-limit";
import {
  automationRulesService,
  type AutomationRuleStatus,
  type AutomationRuleChangeType,
} from "../../services/automationRules.service.js";
import { authMiddleware } from "../middleware/auth.js";
import type { RuleCondition, LogicOperator } from "../../services/ruleEvaluator.service.js";

// =============================================================================
// TYPES
// =============================================================================

interface CreateRuleBody {
  name: string;
  description?: string;
  assetCode: string;
  conditions: RuleCondition[];
  logicOperator: LogicOperator;
  actions: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
  status?: AutomationRuleStatus;
  ownerAddress: string;
  cooldownSeconds?: number;
}

interface UpdateRuleBody {
  name?: string;
  description?: string;
  assetCode?: string;
  conditions?: RuleCondition[];
  logicOperator?: LogicOperator;
  actions?: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
  status?: AutomationRuleStatus;
  cooldownSeconds?: number;
  changeReason?: string;
}

interface RuleParams {
  id: string;
}

interface RuleQuerystring {
  ownerAddress?: string;
  assetCode?: string;
  status?: AutomationRuleStatus;
  limit?: string;
  offset?: string;
}

interface HistoryQuerystring {
  ruleId?: string;
  changedBy?: string;
  changeType?: AutomationRuleChangeType;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

interface ExecutionHistoryQuerystring {
  ruleId?: string;
  ruleVersion?: string;
  triggered?: string;
  status?: string;
  executedBy?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

interface SearchQuerystring {
  q?: string;
  ruleId?: string;
  changedBy?: string;
  changeType?: AutomationRuleChangeType;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

interface VersionComparisonParams {
  id: string;
  from: string;
  to: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function getActor(request: FastifyRequest): { id: string; type: "user" | "api_key" | "system" } {
  const apiKeyAuth = (request as any).apiKeyAuth;
  if (apiKeyAuth?.keyId) {
    return { id: apiKeyAuth.keyId, type: "api_key" };
  }
  return { id: apiKeyAuth?.ownerAddress ?? "system", type: "user" };
}

function parseDate(value: string | undefined): Date | undefined {
  return value ? new Date(value) : undefined;
}

// =============================================================================
// ROUTES
// =============================================================================

export async function automationRulesRoutes(server: FastifyInstance) {
  const requireAuth = authMiddleware();
  const requireAuditRead = authMiddleware({ requiredScopes: ["admin:audit"] });

  // ---------------------------------------------------------------------------
  // LIST RULES
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: RuleQuerystring }>(
    "/",
    { preHandler: requireAuth, rateLimit: { max: 60, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Querystring: RuleQuerystring }>, reply: FastifyReply) => {
      try {
        const result = await automationRulesService.listRules({
          ownerAddress: request.query.ownerAddress,
          assetCode: request.query.assetCode,
          status: request.query.status,
          limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
          offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to list automation rules";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // GET RULE
  // ---------------------------------------------------------------------------

  server.get<{ Params: RuleParams }>(
    "/:id",
    { preHandler: requireAuth, rateLimit: { max: 60, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Params: RuleParams }>, reply: FastifyReply) => {
      try {
        const rule = await automationRulesService.getRule(request.params.id);
        if (!rule) {
          return reply.code(404).send({ error: "Automation rule not found" });
        }
        return rule;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get automation rule";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // CREATE RULE
  // ---------------------------------------------------------------------------

  server.post<{ Body: CreateRuleBody }>(
    "/",
    { preHandler: requireAuth, rateLimit: { max: 30, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Body: CreateRuleBody }>, reply: FastifyReply) => {
      try {
        const rule = await automationRulesService.createRule(request.body, getActor(request));
        return reply.code(201).send(rule);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create automation rule";
        return reply.code(400).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // UPDATE RULE
  // ---------------------------------------------------------------------------

  server.patch<{ Params: RuleParams; Body: UpdateRuleBody }>(
    "/:id",
    { preHandler: requireAuth, rateLimit: { max: 30, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Params: RuleParams; Body: UpdateRuleBody }>, reply: FastifyReply) => {
      try {
        const { changeReason, ...updates } = request.body;
        const rule = await automationRulesService.updateRule(
          request.params.id,
          updates,
          getActor(request),
          changeReason
        );
        if (!rule) {
          return reply.code(404).send({ error: "Automation rule not found" });
        }
        return rule;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update automation rule";
        return reply.code(400).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // DELETE RULE
  // ---------------------------------------------------------------------------

  server.delete<{ Params: RuleParams; Body?: { changeReason?: string } }>(
    "/:id",
    { preHandler: requireAuth, rateLimit: { max: 30, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Params: RuleParams; Body?: { changeReason?: string } }>, reply: FastifyReply) => {
      try {
        const deleted = await automationRulesService.deleteRule(
          request.params.id,
          getActor(request),
          request.body?.changeReason
        );
        if (!deleted) {
          return reply.code(404).send({ error: "Automation rule not found" });
        }
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete automation rule";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // ACTIVATE / DEACTIVATE
  // ---------------------------------------------------------------------------

  server.post<{ Params: RuleParams; Body?: { changeReason?: string } }>(
    "/:id/activate",
    { preHandler: requireAuth, rateLimit: { max: 30, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Params: RuleParams; Body?: { changeReason?: string } }>, reply: FastifyReply) => {
      try {
        const rule = await automationRulesService.activateRule(
          request.params.id,
          getActor(request),
          request.body?.changeReason
        );
        if (!rule) {
          return reply.code(404).send({ error: "Automation rule not found" });
        }
        return rule;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to activate automation rule";
        return reply.code(500).send({ error: message });
      }
    }
  );

  server.post<{ Params: RuleParams; Body?: { changeReason?: string } }>(
    "/:id/deactivate",
    { preHandler: requireAuth, rateLimit: { max: 30, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Params: RuleParams; Body?: { changeReason?: string } }>, reply: FastifyReply) => {
      try {
        const rule = await automationRulesService.deactivateRule(
          request.params.id,
          getActor(request),
          request.body?.changeReason
        );
        if (!rule) {
          return reply.code(404).send({ error: "Automation rule not found" });
        }
        return rule;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to deactivate automation rule";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // RULE HISTORY (AUDIT TRAIL)
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: HistoryQuerystring }>(
    "/history",
    { preHandler: requireAuditRead, rateLimit: { max: 60, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Querystring: HistoryQuerystring }>, reply: FastifyReply) => {
      try {
        const result = await automationRulesService.getRuleHistory({
          ruleId: request.query.ruleId,
          changedBy: request.query.changedBy,
          changeType: request.query.changeType,
          from: parseDate(request.query.from),
          to: parseDate(request.query.to),
          limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
          offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get rule history";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // RULE HISTORY SEARCH
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: SearchQuerystring }>(
    "/history/search",
    { preHandler: requireAuditRead, rateLimit: { max: 60, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Querystring: SearchQuerystring }>, reply: FastifyReply) => {
      try {
        const result = await automationRulesService.searchRuleHistory({
          q: request.query.q,
          ruleId: request.query.ruleId,
          changedBy: request.query.changedBy,
          changeType: request.query.changeType,
          from: parseDate(request.query.from),
          to: parseDate(request.query.to),
          limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
          offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to search rule history";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // RULE VERSION COMPARISON
  // ---------------------------------------------------------------------------

  server.get<{ Params: VersionComparisonParams }>(
    "/:id/versions/:from/compare/:to",
    { preHandler: requireAuditRead, rateLimit: { max: 60, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Params: VersionComparisonParams }>, reply: FastifyReply) => {
      try {
        const comparison = await automationRulesService.compareVersions(
          request.params.id,
          parseInt(request.params.from, 10),
          parseInt(request.params.to, 10)
        );
        if (!comparison) {
          return reply.code(404).send({ error: "Rule versions not found" });
        }
        return comparison;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to compare versions";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // EXECUTION HISTORY
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: ExecutionHistoryQuerystring }>(
    "/executions",
    { preHandler: requireAuditRead, rateLimit: { max: 60, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Querystring: ExecutionHistoryQuerystring }>, reply: FastifyReply) => {
      try {
        const result = await automationRulesService.getExecutionHistory({
          ruleId: request.query.ruleId,
          ruleVersion: request.query.ruleVersion ? parseInt(request.query.ruleVersion, 10) : undefined,
          triggered: request.query.triggered !== undefined ? request.query.triggered === "true" : undefined,
          status: request.query.status,
          executedBy: request.query.executedBy,
          from: parseDate(request.query.from),
          to: parseDate(request.query.to),
          limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
          offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get execution history";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // EXPORT RULE HISTORY CSV
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: HistoryQuerystring }>(
    "/history/export",
    { preHandler: requireAuditRead, rateLimit: { max: 10, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Querystring: HistoryQuerystring }>, reply: FastifyReply) => {
      try {
        const csv = await automationRulesService.exportRuleHistoryCsv({
          ruleId: request.query.ruleId,
          changedBy: request.query.changedBy,
          changeType: request.query.changeType,
          from: parseDate(request.query.from),
          to: parseDate(request.query.to),
        });
        return reply
          .code(200)
          .header("Content-Type", "text/csv")
          .header("Content-Disposition", `attachment; filename="automation-rule-history-${Date.now()}.csv"`)
          .send(csv);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to export rule history";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // EXPORT EXECUTION HISTORY CSV
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: ExecutionHistoryQuerystring }>(
    "/executions/export",
    { preHandler: requireAuditRead, rateLimit: { max: 10, timeWindow: "1 minute" } } as any,
    async (request: FastifyRequest<{ Querystring: ExecutionHistoryQuerystring }>, reply: FastifyReply) => {
      try {
        const csv = await automationRulesService.exportExecutionHistoryCsv({
          ruleId: request.query.ruleId,
          ruleVersion: request.query.ruleVersion ? parseInt(request.query.ruleVersion, 10) : undefined,
          triggered: request.query.triggered !== undefined ? request.query.triggered === "true" : undefined,
          status: request.query.status,
          executedBy: request.query.executedBy,
          from: parseDate(request.query.from),
          to: parseDate(request.query.to),
        });
        return reply
          .code(200)
          .header("Content-Type", "text/csv")
          .header("Content-Disposition", `attachment; filename="automation-rule-executions-${Date.now()}.csv"`)
          .send(csv);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to export execution history";
        return reply.code(500).send({ error: message });
      }
    }
  );
}
