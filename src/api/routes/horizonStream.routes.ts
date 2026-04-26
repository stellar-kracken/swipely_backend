import type { FastifyInstance } from "fastify";
import { horizonStreamManager, type HorizonStreamConfig } from "../../services/horizonStreamSupervisor.service.js";

export async function horizonStreamRoutes(server: FastifyInstance) {
  // GET /api/v1/horizon-streams — list all managed streams
  server.get(
    "/",
    {
      schema: {
        tags: ["Horizon Streams"],
        summary: "List all Horizon stream supervisors",
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (_request, _reply) => {
      return { streams: horizonStreamManager.list() };
    }
  );

  // GET /api/v1/horizon-streams/checkpoints — all stream cursors
  server.get(
    "/checkpoints",
    {
      schema: {
        tags: ["Horizon Streams"],
        summary: "Get checkpoints (cursors) for all streams",
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (_request, _reply) => {
      return { checkpoints: horizonStreamManager.checkpoints() };
    }
  );

  // GET /api/v1/horizon-streams/:streamId — single stream health
  server.get<{ Params: { streamId: string } }>(
    "/:streamId",
    {
      schema: {
        tags: ["Horizon Streams"],
        summary: "Get health metrics for a single Horizon stream",
        params: {
          type: "object",
          properties: { streamId: { type: "string" } },
          required: ["streamId"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const supervisor = horizonStreamManager.get(request.params.streamId);
      if (!supervisor) return reply.status(404).send({ error: "Stream not found" });
      return supervisor.getHealthMetrics();
    }
  );

  // GET /api/v1/horizon-streams/:streamId/checkpoint
  server.get<{ Params: { streamId: string } }>(
    "/:streamId/checkpoint",
    {
      schema: {
        tags: ["Horizon Streams"],
        summary: "Get checkpoint for a single Horizon stream",
        params: {
          type: "object",
          properties: { streamId: { type: "string" } },
          required: ["streamId"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const supervisor = horizonStreamManager.get(request.params.streamId);
      if (!supervisor) return reply.status(404).send({ error: "Stream not found" });
      return supervisor.getCheckpoint();
    }
  );

  // POST /api/v1/horizon-streams — add a new stream supervisor
  server.post<{ Body: HorizonStreamConfig }>(
    "/",
    {
      schema: {
        tags: ["Horizon Streams"],
        summary: "Add and start a new Horizon stream supervisor",
        body: {
          type: "object",
          required: ["streamId", "url"],
          properties: {
            streamId: { type: "string" },
            url: { type: "string" },
            cursor: { type: "string" },
            gapThresholdMs: { type: "number" },
            maxReconnectAttempts: { type: "number" },
            baseBackoffMs: { type: "number" },
            maxBackoffMs: { type: "number" },
            timeoutMs: { type: "number" },
          },
        },
        response: {
          201: { type: "object", additionalProperties: true },
          409: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const supervisor = horizonStreamManager.add(request.body);
        return reply.status(201).send(supervisor.getHealthMetrics());
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Conflict";
        return reply.status(409).send({ error: msg });
      }
    }
  );

  // DELETE /api/v1/horizon-streams/:streamId — stop and remove a stream
  server.delete<{ Params: { streamId: string } }>(
    "/:streamId",
    {
      schema: {
        tags: ["Horizon Streams"],
        summary: "Stop and remove a Horizon stream supervisor",
        params: {
          type: "object",
          properties: { streamId: { type: "string" } },
          required: ["streamId"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const removed = horizonStreamManager.remove(request.params.streamId);
      if (!removed) return reply.status(404).send({ error: "Stream not found" });
      return { ok: true };
    }
  );
}
