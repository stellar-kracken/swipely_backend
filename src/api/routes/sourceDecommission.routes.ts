import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { sourceDecommissionService, type StartDecommissionInput } from "../../services/sourceDecommission.service.js";

const sourceKeySchema = z.string().trim().min(1).max(120);

const startBodySchema = z.object({
  sourceKey: sourceKeySchema,
  replacementSourceKey: sourceKeySchema,
  deprecationPeriodDays: z.number().int().positive().max(3650).optional(),
  reason: z.string().trim().max(500).optional(),
});

const progressBodySchema = z.object({
  progressPct: z.number().min(0).max(100),
});

const rollbackBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export async function sourceDecommissionRoutes(server: FastifyInstance) {
  const requireOps = authMiddleware({ requiredScopes: ["admin:config"] });

  server.get(
    "/",
    {
      schema: {
        tags: ["Source Decommission"],
        summary: "List all source decommission flows",
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (_request, reply) => {
      const decommissions = await sourceDecommissionService.listDecommissions();
      return reply.send({ decommissions });
    }
  );

  server.get<{ Params: { sourceKey: string } }>(
    "/:sourceKey",
    {
      schema: {
        tags: ["Source Decommission"],
        summary: "Get decommission status for a source",
        params: { type: "object", required: ["sourceKey"], properties: { sourceKey: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true }, 404: { $ref: "Error#" } },
      },
    },
    async (request, reply) => {
      const decommission = await sourceDecommissionService.getStatus(request.params.sourceKey);
      if (!decommission) {
        return reply.code(404).send({ error: "No decommission found for source" });
      }
      return reply.send({ decommission });
    }
  );

  server.get<{ Params: { sourceKey: string } }>(
    "/:sourceKey/fallback",
    {
      schema: {
        tags: ["Source Decommission"],
        summary: "Resolve the active fallback source for a decommissioned source, if any",
        params: { type: "object", required: ["sourceKey"], properties: { sourceKey: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const fallbackSourceKey = await sourceDecommissionService.getFallbackSource(request.params.sourceKey);
      return reply.send({ sourceKey: request.params.sourceKey, fallbackSourceKey });
    }
  );

  server.post(
    "/",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Source Decommission"],
        summary: "Start a decommission flow for a data source",
        body: { type: "object", additionalProperties: true },
        response: { 201: { type: "object", additionalProperties: true } },
      },
    },
    async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const body = startBodySchema.parse(request.body);
      const decommission = await sourceDecommissionService.startDecommission({
        ...body,
        actorId: request.apiKeyAuth?.id ?? request.apiKeyAuth?.name ?? "admin",
      } as StartDecommissionInput);
      return reply.code(201).send({ decommission });
    }
  );

  server.put<{ Params: { sourceKey: string }; Body: { progressPct: number } }>(
    "/:sourceKey/progress",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Source Decommission"],
        summary: "Update data migration progress for a decommission flow",
        params: { type: "object", required: ["sourceKey"], properties: { sourceKey: { type: "string" } } },
        body: { type: "object", required: ["progressPct"], properties: { progressPct: { type: "number" } } },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const body = progressBodySchema.parse(request.body);
      const decommission = await sourceDecommissionService.updateMigrationProgress(
        request.params.sourceKey,
        body.progressPct,
        request.apiKeyAuth?.id ?? request.apiKeyAuth?.name ?? "admin"
      );
      return reply.send({ decommission });
    }
  );

  server.get<{ Params: { sourceKey: string } }>(
    "/:sourceKey/completion-check",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Source Decommission"],
        summary: "Check whether a decommission is eligible to be completed",
        params: { type: "object", required: ["sourceKey"], properties: { sourceKey: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const check = await sourceDecommissionService.checkCompletion(request.params.sourceKey);
      return reply.send(check);
    }
  );

  server.post<{ Params: { sourceKey: string } }>(
    "/:sourceKey/complete",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Source Decommission"],
        summary: "Finalize a decommission after verifying completion criteria",
        params: { type: "object", required: ["sourceKey"], properties: { sourceKey: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true }, 400: { $ref: "Error#" } },
      },
    },
    async (request, reply) => {
      try {
        const decommission = await sourceDecommissionService.completeDecommission(
          request.params.sourceKey,
          request.apiKeyAuth?.id ?? request.apiKeyAuth?.name ?? "admin"
        );
        return reply.send({ decommission });
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "Completion check failed" });
      }
    }
  );

  server.post<{ Params: { sourceKey: string }; Body: { reason?: string } }>(
    "/:sourceKey/rollback",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Source Decommission"],
        summary: "Roll back a decommission flow and disable fallback routing",
        params: { type: "object", required: ["sourceKey"], properties: { sourceKey: { type: "string" } } },
        body: { type: "object", properties: { reason: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const body = rollbackBodySchema.parse(request.body ?? {});
      const decommission = await sourceDecommissionService.rollbackDecommission(
        request.params.sourceKey,
        request.apiKeyAuth?.id ?? request.apiKeyAuth?.name ?? "admin",
        body.reason
      );
      return reply.send({ decommission });
    }
  );
}
