import type { FastifyInstance } from "fastify";
import { AlertService } from "../../services/alert.service.js";
import type {
  AlertCondition,
  AlertPriority,
  ConditionOp,
} from "../../services/alert.service.js";

export async function alertsRoutes(server: FastifyInstance) {
  const alertService = new AlertService();

  // GET /api/v1/alerts/rules - list rules for an owner
  server.get<{ Querystring: { owner: string } }>(
    "/rules",
    async (request, reply) => {
      const { owner } = request.query;
      if (!owner) {
        return reply.status(400).send({ error: "owner query param required" });
      }
      const rules = await alertService.getRulesForOwner(owner);
      return {
        rules: rules.map((rule) => ({
          ...rule,
          owner_address: rule.ownerAddress,
        })),
      };
    }
  );

  // POST /api/v1/alerts/rules - create a rule
  server.post<{
    Body: {
      ownerAddress: string;
      name: string;
      assetCode: string;
      conditions: AlertCondition[];
      conditionOp: ConditionOp;
      priority: AlertPriority;
      cooldownSeconds: number;
      webhookUrl?: string;
    };
  }>("/rules", async (request, reply) => {
    const {
      ownerAddress,
      name,
      assetCode,
      conditions,
      conditionOp,
      priority,
      cooldownSeconds,
      webhookUrl,
    } = request.body;

    const rule = await alertService.createRule(
      ownerAddress,
      name,
      assetCode,
      conditions,
      conditionOp,
      priority,
      cooldownSeconds,
      webhookUrl
    );

    return reply.status(201).send({ rule });
  });

  // GET /api/v1/alerts/rules/:ruleId
  server.get<{ Params: { ruleId: string } }>(
    "/rules/:ruleId",
    async (request, reply) => {
      const rule = await alertService.getRule(request.params.ruleId);
      if (!rule) return reply.status(404).send({ error: "Rule not found" });
      return { rule };
    }
  );

  // PATCH /api/v1/alerts/rules/:ruleId
  server.patch<{
    Params: { ruleId: string };
    Body: {
      ownerAddress: string;
      name?: string;
      conditions?: AlertCondition[];
      conditionOp?: ConditionOp;
      priority?: AlertPriority;
      cooldownSeconds?: number;
      webhookUrl?: string | null;
    };
  }>("/rules/:ruleId", async (request, reply) => {
    const { ruleId } = request.params;
    const { ownerAddress, ...updates } = request.body;
    const rule = await alertService.updateRule(ruleId, ownerAddress, updates);
    if (!rule) return reply.status(404).send({ error: "Rule not found" });
    return { rule };
  });

  // PATCH /api/v1/alerts/rules/:ruleId/active
  server.patch<{
    Params: { ruleId: string };
    Body: { ownerAddress: string; isActive: boolean };
  }>("/rules/:ruleId/active", async (request, reply) => {
    const { ruleId } = request.params;
    const { ownerAddress, isActive } = request.body;
    const ok = await alertService.setRuleActive(ruleId, ownerAddress, isActive);
    if (!ok) return reply.status(404).send({ error: "Rule not found" });
    return { success: true };
  });

  // GET /api/v1/alerts/history/:assetCode
  server.get<{
    Params: { assetCode: string };
    Querystring: { limit?: string };
  }>("/history/:assetCode", async (request, _reply) => {
    const { assetCode } = request.params;
    const limit = parseInt(request.query.limit ?? "50", 10);
    const events = await alertService.getAlertHistory(assetCode, limit);
    return { events };
  });

  // GET /api/v1/alerts/recent
  server.get<{ Querystring: { limit?: string } }>(
    "/recent",
    async (request, _reply) => {
      const limit = parseInt(request.query.limit ?? "100", 10);
      const events = await alertService.getRecentAlerts(limit);
      return { events };
    }
  );

  // GET /api/v1/alerts/rules/:ruleId/events
  server.get<{
    Params: { ruleId: string };
    Querystring: { limit?: string };
  }>("/rules/:ruleId/events", async (request, _reply) => {
    const { ruleId } = request.params;
    const limit = parseInt(request.query.limit ?? "50", 10);
    const events = await alertService.getAlertsForRule(ruleId, limit);
    return { events };
  });
}
