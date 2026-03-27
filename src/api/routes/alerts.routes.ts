import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AlertService } from "../../services/alert.service.js";
import { authMiddleware } from "../middleware/auth.js";
import { applyStrictRateLimit } from "../middleware/rateLimit.js";
import {
  getPaginationParams,
  formatPaginatedResponse,
} from "../../utils/pagination.js";
import {
  CreateAlertRuleSchema,
  UpdateAlertRuleSchema,
  BulkCreateAlertRulesSchema,
  BulkUpdateAlertRulesSchema,
  BulkDeleteAlertRulesSchema,
  AlertHistoryQuerySchema,
  DryRunAlertSchema,
} from "../validations/alert.schema.js";

export async function alertsRoutes(server: FastifyInstance) {
  const alertService = new AlertService();

  // Apply strict rate limiting to this plugin
  await applyStrictRateLimit(server);

  // Add auth middleware as preHandler for all routes in this plugin
  server.addHook("preHandler", authMiddleware);

  // GET /api/v1/alerts/rules - list rules for an owner
  server.get<{ Querystring: { owner: string } }>(
    "/rules",
    async (request, reply) => {
      const { owner } = request.query;
      if (!owner) {
        return reply.status(400).send({ error: "owner query param required" });
      }
      const rules = await alertService.getRulesForOwner(owner);
      return { rules };
    }
  );

  // POST /api/v1/alerts/rules - create a rule
  server.post(
    "/rules",
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      const data = CreateAlertRuleSchema.parse(request.body);
      const { ownerAddress } = request.body as any;

      if (!ownerAddress) {
        return reply.status(400).send({ error: "ownerAddress required" });
      }

      const rule = await alertService.createRule(
        ownerAddress,
        data.name,
        data.assetCode,
        data.conditions,
        data.conditionOp,
        data.priority,
        data.cooldownSeconds,
        data.webhookUrl
      );

      return reply.status(201).send({ rule });
    }
  );

  // POST /api/v1/alerts/rules/bulk - bulk create rules
  server.post(
    "/rules/bulk",
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      const { rules } = BulkCreateAlertRulesSchema.parse(request.body);
      const { ownerAddress } = request.body as any;

      if (!ownerAddress) {
        return reply.status(400).send({ error: "ownerAddress required" });
      }

      const createdRules = await alertService.bulkCreateRules(ownerAddress, rules);
      return reply.status(201).send({ rules: createdRules });
    }
  );

  // GET  /api/v1/alerts/rules/:ruleId
  server.get<{ Params: { ruleId: string } }>(
    "/rules/:ruleId",
    async (request, reply) => {
      const rule = await alertService.getRule(request.params.ruleId);
      if (!rule) return reply.status(404).send({ error: "Rule not found" });
      return { rule };
    }
  );

  // PATCH /api/v1/alerts/rules/:ruleId
  server.patch(
    "/rules/:ruleId",
    async (
      request: FastifyRequest<{ Params: { ruleId: string }; Body: any }>,
      reply: FastifyReply
    ) => {
      const data = UpdateAlertRuleSchema.parse(request.body);
      const { ownerAddress } = request.body as any;
      const { ruleId } = request.params;

      if (!ownerAddress) {
        return reply.status(400).send({ error: "ownerAddress required" });
      }

      const rule = await alertService.updateRule(ruleId, ownerAddress, data);
      if (!rule) return reply.status(404).send({ error: "Rule not found" });
      return { rule };
    }
  );

  // PATCH /api/v1/alerts/rules/bulk - bulk update rules
  server.patch(
    "/rules/bulk",
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      const { updates } = BulkUpdateAlertRulesSchema.parse(request.body);
      const { ownerAddress } = request.body as any;

      if (!ownerAddress) {
        return reply.status(400).send({ error: "ownerAddress required" });
      }

      const updatedRules = await alertService.bulkUpdateRules(ownerAddress, updates);
      return { rules: updatedRules };
    }
  );

  // DELETE /api/v1/alerts/rules/:ruleId
  server.delete<{ Params: { ruleId: string }; Body: { ownerAddress: string } }>(
    "/rules/:ruleId",
    async (request, reply) => {
      const { ruleId } = request.params;
      const { ownerAddress } = request.body as any;

      if (!ownerAddress) {
        return reply.status(400).send({ error: "ownerAddress required" });
      }

      const ok = await alertService.deleteRule(ruleId, ownerAddress);
      if (!ok) return reply.status(404).send({ error: "Rule not found" });
      return reply.status(204).send();
    }
  );

  // DELETE /api/v1/alerts/rules/bulk - bulk delete rules
  server.delete(
    "/rules/bulk",
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      const { ruleIds } = BulkDeleteAlertRulesSchema.parse(request.body);
      const { ownerAddress } = request.body as any;

      if (!ownerAddress) {
        return reply.status(400).send({ error: "ownerAddress required" });
      }

      const count = await alertService.bulkDeleteRules(ownerAddress, ruleIds);
      return { deletedCount: count };
    }
  );

  // PATCH /api/v1/alerts/rules/:ruleId/active (Pause/Resume)
  server.patch<{
    Params: { ruleId: string };
    Body: { ownerAddress: string; isActive: boolean };
  }>("/rules/:ruleId/active", async (request, reply) => {
    const { ruleId } = request.params;
    const { ownerAddress, isActive } = request.body;

    if (!ownerAddress) {
      return reply.status(400).send({ error: "ownerAddress required" });
    }

    const ok = await alertService.setRuleActive(ruleId, ownerAddress, isActive);
    if (!ok) return reply.status(404).send({ error: "Rule not found" });
    return { success: true };
  });

  // GET /api/v1/alerts/history - paginated history
  server.get("/history", async (request: FastifyRequest<{ Querystring: any }>) => {
    const query = AlertHistoryQuerySchema.parse(request.query);
    const { limit, offset, page } = getPaginationParams(query);

    const events = await alertService.getRecentAlerts(limit);
    const total = events.length;

    return formatPaginatedResponse(events, total, page, limit);
  });

  // GET /api/v1/alerts/history/:assetCode
  server.get<{
    Params: { assetCode: string };
    Querystring: { limit?: string };
  }>("/history/:assetCode", async (request) => {
    const { assetCode } = request.params;
    const limit = parseInt(request.query.limit ?? "50", 10);
    const events = await alertService.getAlertHistory(assetCode, limit);
    return { events };
  });

  // GET /api/v1/alerts/stats
  server.get<{ Querystring: { owner: string } }>(
    "/stats",
    async (request, reply) => {
      const { owner } = request.query;
      if (!owner) {
        return reply.status(400).send({ error: "owner query param required" });
      }
      const stats = await alertService.getAlertStats(owner);
      return stats;
    }
  );

  // POST /api/v1/alerts/test - dry run
  server.post(
    "/test",
    async (request: FastifyRequest<{ Body: any }>) => {
      const { rule, metrics } = DryRunAlertSchema.parse(request.body);
      const result = await alertService.dryRunAlert(rule as any, metrics);
      return result;
    }
  );

  // GET /api/v1/alerts/recent
  server.get<{ Querystring: { limit?: string } }>(
    "/recent",
    async (request) => {
      const limit = parseInt(request.query.limit ?? "100", 10);
      const events = await alertService.getRecentAlerts(limit);
      return { events };
    }
  );

  // GET /api/v1/alerts/rules/:ruleId/events
  server.get<{
    Params: { ruleId: string };
    Querystring: { limit?: string };
  }>("/rules/:ruleId/events", async (request) => {
    const { ruleId } = request.params;
    const limit = parseInt(request.query.limit ?? "50", 10);
    const events = await alertService.getAlertsForRule(ruleId, limit);
    return { events };
  });
}
