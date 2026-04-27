import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  alertSuppressionService,
  createSuppressionRuleSchema,
  updateSuppressionRuleSchema,
} from "../../services/alertSuppression.service.js";

type RuleIdParams = { id: string };

const listQuerySchema = z.object({
  includeExpired: z.coerce.boolean().optional(),
});

const previewSchema = z.object({
  actor: z.string().min(1),
  assetCode: z.string().min(1),
  alertType: z.enum([
    "price_deviation",
    "supply_mismatch",
    "bridge_downtime",
    "health_score_drop",
    "volume_anomaly",
    "reserve_ratio_breach",
  ]),
  priority: z.enum(["critical", "high", "medium", "low"]),
  source: z.string().min(1),
  at: z.coerce.date().optional(),
});

const maintenanceOverrideSchema = z.object({
  actor: z.string().min(1),
  description: z.string().max(500).optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  sources: z.array(z.string().min(1)).max(100).optional(),
  assetCodes: z.array(z.string().min(1)).max(100).optional(),
});

export async function alertSuppressionRoutes(server: FastifyInstance) {
  server.get<{ Querystring: z.infer<typeof listQuerySchema> }>("/rules", async (request) => {
    const query = listQuerySchema.parse(request.query);
    const rules = await alertSuppressionService.listRules(query.includeExpired ?? false);
    return { rules };
  });

  server.post<{ Body: z.infer<typeof createSuppressionRuleSchema> }>("/rules", async (request, reply) => {
    try {
      const rule = await alertSuppressionService.createRule(request.body);
      return reply.code(201).send({ rule });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create suppression rule";
      return reply.code(400).send({ error: message });
    }
  });

  server.patch<{ Params: RuleIdParams; Body: z.infer<typeof updateSuppressionRuleSchema> }>("/rules/:id", async (request, reply) => {
    try {
      const rule = await alertSuppressionService.updateRule(request.params.id, request.body);
      if (!rule) return reply.code(404).send({ error: "Rule not found" });
      return { rule };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update suppression rule";
      return reply.code(400).send({ error: message });
    }
  });

  server.delete<{ Params: RuleIdParams; Body: { actor: string } }>("/rules/:id", async (request, reply) => {
    if (!request.body?.actor) {
      return reply.code(400).send({ error: "actor is required" });
    }

    const deleted = await alertSuppressionService.deleteRule(request.params.id, request.body.actor);
    if (!deleted) return reply.code(404).send({ error: "Rule not found" });
    return reply.code(204).send();
  });

  server.post<{ Body: z.infer<typeof previewSchema> }>("/preview", async (request, reply) => {
    try {
      const payload = previewSchema.parse(request.body);
      const decision = await alertSuppressionService.preview(
        {
          assetCode: payload.assetCode,
          alertType: payload.alertType,
          priority: payload.priority,
          source: payload.source,
          at: payload.at,
        },
        payload.actor
      );
      return { decision };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to preview suppression";
      return reply.code(400).send({ error: message });
    }
  });

  server.get<{ Querystring: { limit?: number } }>("/audit", async (request: FastifyRequest<{ Querystring: { limit?: number } }>) => {
    const limit = Math.max(1, Math.min(500, Number(request.query.limit ?? 100)));
    const records = await alertSuppressionService.getAuditHistory(limit);
    return { records };
  });

  server.post<{ Body: z.infer<typeof maintenanceOverrideSchema> }>("/maintenance/override", async (request: FastifyRequest<{ Body: z.infer<typeof maintenanceOverrideSchema> }>, reply: FastifyReply) => {
    try {
      const payload = maintenanceOverrideSchema.parse(request.body);
      const rule = await alertSuppressionService.createRule({
        actor: payload.actor,
        name: `Maintenance Override ${payload.startAt.toISOString()}`,
        description: payload.description,
        maintenanceMode: true,
        windowStart: payload.startAt,
        windowEnd: payload.endAt,
        sources: payload.sources,
        assetCodes: payload.assetCodes,
        isActive: true,
      });
      return reply.code(201).send({ rule });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create maintenance override";
      return reply.code(400).send({ error: message });
    }
  });
}
