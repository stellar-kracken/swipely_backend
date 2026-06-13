import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { stalenessDetectionService } from "../../services/stalenessDetection.service.js";

interface SnapshotQuery {
  includeHistory?: boolean;
  historyLimit?: number;
}

interface SourceQuery {
  historyLimit?: number;
}

function normalizeHistoryLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 2), 50);
}

export async function freshnessRoutes(server: FastifyInstance) {
  server.get<{ Querystring: SnapshotQuery }>(
    "/",
    {
      schema: {
        tags: ["Freshness"],
        summary: "Get freshness snapshot for monitored sources",
        querystring: {
          type: "object",
          properties: {
            includeHistory: { type: "boolean", default: false },
            historyLimit: { type: "integer", minimum: 2, maximum: 50, default: 10 },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: SnapshotQuery }>) => {
      const includeHistory = String(request.query.includeHistory ?? "false") === "true";
      const historyLimit = request.query.historyLimit
        ? normalizeHistoryLimit(request.query.historyLimit, 10)
        : includeHistory
        ? 10
        : 2;

      return stalenessDetectionService.getSnapshot({
        includeHistory,
        historyLimit,
      });
    }
  );

  server.get<{ Params: { source: string }; Querystring: SourceQuery }>(
    "/:source",
    {
      schema: {
        tags: ["Freshness"],
        summary: "Get freshness detail for a specific source",
        params: {
          type: "object",
          required: ["source"],
          properties: {
            source: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            historyLimit: { type: "integer", minimum: 2, maximum: 50, default: 10 },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { source: string }; Querystring: SourceQuery }>,
      reply: FastifyReply
    ) => {
      const historyLimit = request.query.historyLimit
        ? normalizeHistoryLimit(request.query.historyLimit, 10)
        : 10;
      const detail = await stalenessDetectionService.getSourceDetail(request.params.source, {
        includeHistory: true,
        historyLimit,
      });

      if (!detail) {
        return reply.status(404).send({ error: "Source not found" });
      }

      return detail;
    }
  );

  server.get<{ Params: { source: string }; Querystring: SourceQuery }>(
    "/:source/trend",
    {
      schema: {
        tags: ["Freshness"],
        summary: "Get freshness trend data for a specific source",
        params: {
          type: "object",
          required: ["source"],
          properties: {
            source: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            historyLimit: { type: "integer", minimum: 2, maximum: 50, default: 10 },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { source: string }; Querystring: SourceQuery }>,
      reply: FastifyReply
    ) => {
      const historyLimit = request.query.historyLimit
        ? normalizeHistoryLimit(request.query.historyLimit, 10)
        : 10;
      const detail = await stalenessDetectionService.getSourceDetail(request.params.source, {
        includeHistory: true,
        historyLimit,
      });

      if (!detail) {
        return reply.status(404).send({ error: "Source not found" });
      }

      return {
        key: detail.key,
        label: detail.label,
        trend: detail.trend,
        expectedIntervalMs: detail.expectedIntervalMs,
        lastUpdated: detail.lastUpdated,
        recentIntervalsMs: detail.recentIntervalsMs ?? [],
        history: detail.history ?? [],
      };
    }
  );

  server.get(
    "/alerts",
    {
      schema: {
        tags: ["Freshness"],
        summary: "Get freshness alerts",
        response: {
          200: {
            type: "object",
            properties: {
              alerts: { type: "array", items: { type: "object", additionalProperties: true } },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async () => {
      const alerts = await stalenessDetectionService.getAlerts();
      return { alerts, timestamp: new Date().toISOString() };
    }
  );
}
