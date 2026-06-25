import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { eventReplayService } from "../../services/eventReplay.service.js";

const filterSchema = z.object({
  aggregateType: z.string().trim().min(1).max(64).optional(),
  aggregateId: z.string().trim().min(1).optional(),
  eventType: z.string().trim().min(1).max(64).optional(),
  status: z.enum(["delivered", "failed"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const executeBodySchema = z.object({
  filter: filterSchema,
  dryRun: z.boolean().default(true),
  reason: z.string().trim().max(500).optional(),
  confirm: z.boolean().optional(),
});

export async function eventReplayRoutes(server: FastifyInstance) {
  const requireOps = authMiddleware({ requiredScopes: ["admin:config"] });

  server.post(
    "/preview",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Event Replay"],
        summary: "Preview events matching a replay filter without replaying them",
        body: { type: "object", additionalProperties: true },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const filter = filterSchema.parse((request.body as { filter?: unknown })?.filter ?? request.body ?? {});
      const result = await eventReplayService.previewReplay({
        ...filter,
        from: filter.from ? new Date(filter.from) : undefined,
        to: filter.to ? new Date(filter.to) : undefined,
      });
      return reply.send(result);
    }
  );

  server.post(
    "/",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Event Replay"],
        summary: "Replay historical outbox events (dry run by default)",
        body: { type: "object", additionalProperties: true },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const body = executeBodySchema.parse(request.body);
      const run = await eventReplayService.executeReplay({
        filter: {
          ...body.filter,
          from: body.filter.from ? new Date(body.filter.from) : undefined,
          to: body.filter.to ? new Date(body.filter.to) : undefined,
        },
        dryRun: body.dryRun,
        reason: body.reason,
        confirm: body.confirm,
        requestedBy: request.apiKeyAuth?.id ?? request.apiKeyAuth?.name ?? "admin",
      });
      return reply.send({ run });
    }
  );

  server.get(
    "/",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Event Replay"],
        summary: "List recent event replay runs",
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (_request, reply) => {
      const runs = await eventReplayService.listReplayRuns();
      return reply.send({ runs });
    }
  );

  server.get<{ Params: { id: string } }>(
    "/:id",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Event Replay"],
        summary: "Get the status of a single replay run",
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true }, 404: { $ref: "Error#" } },
      },
    },
    async (request, reply) => {
      const run = await eventReplayService.getReplayRun(request.params.id);
      if (!run) {
        return reply.code(404).send({ error: "Replay run not found" });
      }
      return reply.send({ run });
    }
  );
}
