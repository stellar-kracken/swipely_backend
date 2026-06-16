import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { duplicateAlertCheckService } from "../../services/duplicateAlertCheck.service.js";
import { authMiddleware } from "../middleware/auth.js";

export async function duplicateAlertCheckRoutes(server: FastifyInstance) {
  server.addHook("preHandler", authMiddleware());

  // GET /dedup-rules — list all configured dedup rules
  server.get(
    "/dedup-rules",
    {
      schema: {
        tags: ["Duplicate Alert Check"],
        summary: "List all dedup rules",
        security: [{ ApiKeyAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              rules: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    },
    async () => ({ rules: duplicateAlertCheckService.getDedupRules() })
  );

  // GET /dedup-rules/:id — get single rule
  server.get<{ Params: { id: string } }>(
    "/dedup-rules/:id",
    {
      schema: {
        tags: ["Duplicate Alert Check"],
        summary: "Get a single dedup rule",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const rule = duplicateAlertCheckService.getDedupRule(request.params.id);
      if (!rule) return reply.status(404).send({ error: "Rule not found" });
      return rule;
    }
  );

  // POST /dedup-rules — add a new dedup rule
  server.post<{ Body: any }>(
    "/dedup-rules",
    {
      schema: {
        tags: ["Duplicate Alert Check"],
        summary: "Add a dedup rule",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["name", "windowMs", "matchFields", "severityBehavior"],
          properties: {
            name: { type: "string" },
            alertType: { type: "string", default: "*" },
            assetCode: { type: "string", default: "*" },
            windowMs: { type: "integer", minimum: 1000 },
            matchFields: {
              type: "array",
              items: { type: "string", enum: ["assetCode", "alertType", "metric", "source"] },
            },
            severityBehavior: { type: "string", enum: ["block", "escalate", "review"] },
            isActive: { type: "boolean", default: true },
          },
        },
        response: {
          201: { type: "object", additionalProperties: true },
          400: { $ref: "Error#" },
        },
      },
    },
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      const body = request.body as any;
      const { name, alertType, assetCode, windowMs, matchFields, severityBehavior, isActive } =
        body;
      const rule = duplicateAlertCheckService.addDedupRule({
        name,
        alertType: alertType ?? "*",
        assetCode: assetCode ?? "*",
        windowMs,
        matchFields,
        severityBehavior,
        isActive: isActive ?? true,
      });
      return reply.status(201).send(rule);
    }
  );

  // PATCH /dedup-rules/:id — update a dedup rule
  server.patch<{ Params: { id: string }; Body: any }>(
    "/dedup-rules/:id",
    {
      schema: {
        tags: ["Duplicate Alert Check"],
        summary: "Update a dedup rule",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: { type: "object", additionalProperties: true },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const updated = duplicateAlertCheckService.updateDedupRule(
        request.params.id,
        request.body
      );
      if (!updated) return reply.status(404).send({ error: "Rule not found" });
      return updated;
    }
  );

  // DELETE /dedup-rules/:id — delete a dedup rule
  server.delete<{ Params: { id: string } }>(
    "/dedup-rules/:id",
    {
      schema: {
        tags: ["Duplicate Alert Check"],
        summary: "Delete a dedup rule",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          204: { type: "null" },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const ok = duplicateAlertCheckService.deleteDedupRule(request.params.id);
      if (!ok) return reply.status(404).send({ error: "Rule not found" });
      return reply.status(204).send();
    }
  );

  // GET /review-queue — list review queue entries
  server.get<{ Querystring: { status?: string } }>(
    "/review-queue",
    {
      schema: {
        tags: ["Duplicate Alert Check"],
        summary: "List near-duplicate alerts pending review",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pending", "approved", "rejected"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              entries: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    },
    async (request) => {
      const { status } = request.query;
      const entries = duplicateAlertCheckService.getReviewQueue(
        status as "pending" | "approved" | "rejected" | undefined
      );
      return { entries };
    }
  );

  // POST /review-queue/:id/resolve — approve or reject a review entry
  server.post<{ Params: { id: string }; Body: { action: "approved" | "rejected"; reviewedBy: string } }>(
    "/review-queue/:id/resolve",
    {
      schema: {
        tags: ["Duplicate Alert Check"],
        summary: "Approve or reject a review queue entry",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["action", "reviewedBy"],
          properties: {
            action: { type: "string", enum: ["approved", "rejected"] },
            reviewedBy: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
          409: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const entry = duplicateAlertCheckService.reviewEntry(
        request.params.id,
        request.body.action,
        request.body.reviewedBy
      );
      if (!entry) {
        return reply.status(404).send({ error: "Entry not found or already resolved" });
      }
      return entry;
    }
  );
}
