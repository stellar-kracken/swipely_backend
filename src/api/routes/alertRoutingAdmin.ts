import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { alertRoutingService } from "../../services/alertRouting.service.js";
import {
  createAlertRoutingRuleSchema,
  listAlertRoutingAuditQuerySchema,
  listAlertRoutingRulesQuerySchema,
  updateAlertRoutingRuleSchema,
} from "../validations/alertRouting.schema.js";

export async function alertRoutingAdminRoutes(server: FastifyInstance) {
  const requireAdmin = authMiddleware({ requiredScopes: ["admin:api-keys"] });

  server.get<{ Querystring: { ownerAddress?: string } }>(
    "/rules",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "List alert routing rules",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            ownerAddress: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = listAlertRoutingRulesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const rules = await alertRoutingService.listRules(parsed.data.ownerAddress);
      return { rules };
    }
  );

  server.post(
    "/rules",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Create an alert routing rule",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["name", "channels"],
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            ownerAddress: { type: "string" },
            severityLevels: {
              type: "array",
              items: { type: "string", enum: ["critical", "high", "medium", "low"] },
            },
            assetCodes: { type: "array", items: { type: "string" } },
            sourceTypes: { type: "array", items: { type: "string" } },
            channels: {
              type: "array",
              items: { type: "string", enum: ["in_app", "webhook", "email"] },
            },
            fallbackChannels: {
              type: "array",
              items: { type: "string", enum: ["in_app", "webhook", "email"] },
            },
            suppressionWindowSeconds: { type: "integer" },
            priorityOrder: { type: "integer" },
            isActive: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = createAlertRoutingRuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const rule = await alertRoutingService.createRule({
        ...parsed.data,
        createdBy: request.apiKeyAuth?.name ?? "admin",
      });
      return reply.code(201).send({ rule });
    }
  );

  server.patch<{ Params: { id: string } }>(
    "/rules/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Update an alert routing rule",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            ownerAddress: { type: "string" },
            severityLevels: {
              type: "array",
              items: { type: "string", enum: ["critical", "high", "medium", "low"] },
            },
            assetCodes: { type: "array", items: { type: "string" } },
            sourceTypes: { type: "array", items: { type: "string" } },
            channels: {
              type: "array",
              items: { type: "string", enum: ["in_app", "webhook", "email"] },
            },
            fallbackChannels: {
              type: "array",
              items: { type: "string", enum: ["in_app", "webhook", "email"] },
            },
            suppressionWindowSeconds: { type: "integer" },
            priorityOrder: { type: "integer" },
            isActive: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = updateAlertRoutingRuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const rule = await alertRoutingService.updateRule(request.params.id, parsed.data);
      if (!rule) {
        return reply.code(404).send({ error: "Routing rule not found" });
      }
      return { rule };
    }
  );

  server.delete<{ Params: { id: string } }>(
    "/rules/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Delete an alert routing rule",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const deleted = await alertRoutingService.deleteRule(request.params.id);
      if (!deleted) {
        return reply.code(404).send({ error: "Routing rule not found" });
      }
      return reply.code(204).send();
    }
  );

  server.get<{
    Querystring: {
      ownerAddress?: string;
      status?: "queued" | "delivered" | "suppressed" | "failed" | "fallback";
      channel?: string;
      limit?: number;
    };
  }>(
    "/audit",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Get alert routing audit history",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            ownerAddress: { type: "string" },
            status: {
              type: "string",
              enum: ["queued", "delivered", "suppressed", "failed", "fallback"],
            },
            channel: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = listAlertRoutingAuditQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const entries = await alertRoutingService.getAuditHistory(parsed.data);
      return { entries };
    }
  );
}
