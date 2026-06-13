import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { providerAllowlistService } from "../../services/providerAllowlist.service.js";

const providerKeySchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/i);

const upsertBodySchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  allowed: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export async function providerAllowlistAdminRoutes(server: FastifyInstance) {
  const requireAdmin = authMiddleware({ requiredScopes: ["admin:config"] });

  server.put<{ Params: { providerKey: string }; Body: z.infer<typeof upsertBodySchema> }>(
    "/:providerKey",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Create or update a provider allowlist entry",
        params: {
          type: "object",
          required: ["providerKey"],
          properties: { providerKey: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["allowed"],
          properties: {
            displayName: { type: "string" },
            category: { type: "string" },
            allowed: { type: "boolean" },
            reason: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { entry: { type: "object", additionalProperties: true } } },
          201: { type: "object", properties: { entry: { type: "object", additionalProperties: true } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { providerKey: string }; Body: z.infer<typeof upsertBodySchema> }>, reply: FastifyReply) => {
      const providerKey = providerKeySchema.parse(request.params.providerKey);
      const body = upsertBodySchema.parse(request.body);

      const existing = await providerAllowlistService.getEntry(providerKey);

      const entry = await providerAllowlistService.upsertEntry({
        providerKey,
        displayName: body.displayName,
        category: body.category,
        allowed: body.allowed,
        reason: body.reason ?? null,
        actorId: request.apiKeyAuth?.id ?? request.apiKeyAuth?.name ?? "admin",
        actorType: "api_key",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] as string | undefined,
      });

      const status = existing ? 200 : 201;
      return reply.code(status).send({ entry });
    }
  );

  server.delete<{ Params: { providerKey: string } }>(
    "/:providerKey",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Delete a provider allowlist entry",
        params: {
          type: "object",
          required: ["providerKey"],
          properties: { providerKey: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { deleted: { type: "boolean" } } },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { providerKey: string } }>, reply: FastifyReply) => {
      const providerKey = providerKeySchema.parse(request.params.providerKey);

      const deleted = await providerAllowlistService.deleteEntry({
        providerKey,
        actorId: request.apiKeyAuth?.id ?? request.apiKeyAuth?.name ?? "admin",
        actorType: "api_key",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"] as string | undefined,
      });

      if (!deleted) {
        return reply.code(404).send({ error: "Provider allowlist entry not found" });
      }

      return reply.send({ deleted: true });
    }
  );
}
