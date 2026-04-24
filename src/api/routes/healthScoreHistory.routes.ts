import type { FastifyInstance } from "fastify";
import { HealthScoreHistoryService, type RecordSource } from "../../services/healthScoreHistory.service.js";

const historyService = new HealthScoreHistoryService();

export async function healthScoreHistoryRoutes(server: FastifyInstance) {
  // GET /api/v1/health-score-history/:symbol — time-series for one asset
  server.get<{
    Params: { symbol: string };
    Querystring: { from?: string; to?: string; limit?: string; source?: string };
  }>(
    "/:symbol",
    {
      schema: {
        tags: ["Health Score History"],
        summary: "Get health score history for an asset",
        params: {
          type: "object",
          properties: { symbol: { type: "string" } },
          required: ["symbol"],
        },
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", description: "ISO 8601 start time" },
            to: { type: "string", description: "ISO 8601 end time" },
            limit: { type: "string" },
            source: { type: "string", enum: ["scheduled", "manual", "backfill"] },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, _reply) => {
      const { symbol } = request.params;
      const { from, to, limit, source } = request.query;
      const records = await historyService.getHistory({
        symbol,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit: limit ? Number(limit) : undefined,
        source: source as RecordSource | undefined,
      });
      return { symbol, records, count: records.length };
    }
  );

  // GET /api/v1/health-score-history/:symbol/aggregated — bucketed averages
  server.get<{
    Params: { symbol: string };
    Querystring: { from?: string; to?: string; bucket?: string };
  }>(
    "/:symbol/aggregated",
    {
      schema: {
        tags: ["Health Score History"],
        summary: "Get aggregated health score buckets for an asset",
        params: {
          type: "object",
          properties: { symbol: { type: "string" } },
          required: ["symbol"],
        },
        querystring: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            bucket: { type: "string", description: "Time bucket, e.g. '1 hour', '1 day'" },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, _reply) => {
      const { symbol } = request.params;
      const { from, to, bucket } = request.query;
      const buckets = await historyService.getAggregated({
        symbol,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        bucketInterval: bucket,
      });
      return { symbol, buckets };
    }
  );

  // GET /api/v1/health-score-history/:symbol/trend — delta and direction
  server.get<{
    Params: { symbol: string };
    Querystring: { windowHours?: string };
  }>(
    "/:symbol/trend",
    {
      schema: {
        tags: ["Health Score History"],
        summary: "Get health score trend for an asset",
        params: {
          type: "object",
          properties: { symbol: { type: "string" } },
          required: ["symbol"],
        },
        querystring: {
          type: "object",
          properties: {
            windowHours: { type: "string", description: "Comparison window in hours (default 24)" },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const { symbol } = request.params;
      const windowHours = request.query.windowHours ? Number(request.query.windowHours) : 24;
      const trend = await historyService.getTrend(symbol, windowHours);
      if (!trend) return reply.status(404).send({ error: "No history found for this asset" });
      return { symbol, ...trend };
    }
  );

  // POST /api/v1/health-score-history/backfill — bulk historical import
  server.post<{
    Body: {
      entries: Array<{
        symbol: string;
        overallScore: number;
        liquidityDepthScore?: number;
        priceStabilityScore?: number;
        bridgeUptimeScore?: number;
        reserveBackingScore?: number;
        volumeTrendScore?: number;
        trend?: string;
        recordedAt: string;
      }>;
    };
  }>(
    "/backfill",
    {
      schema: {
        tags: ["Health Score History"],
        summary: "Backfill historical health score data",
        body: {
          type: "object",
          required: ["entries"],
          properties: {
            entries: {
              type: "array",
              items: {
                type: "object",
                required: ["symbol", "overallScore", "recordedAt"],
                properties: {
                  symbol: { type: "string" },
                  overallScore: { type: "number" },
                  liquidityDepthScore: { type: "number" },
                  priceStabilityScore: { type: "number" },
                  bridgeUptimeScore: { type: "number" },
                  reserveBackingScore: { type: "number" },
                  volumeTrendScore: { type: "number" },
                  trend: { type: "string" },
                  recordedAt: { type: "string" },
                },
              },
            },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, _reply) => {
      const { entries } = request.body;
      const mapped = entries.map((e) => ({
        ...e,
        recordedAt: new Date(e.recordedAt),
      }));
      const count = await historyService.backfill(mapped as Parameters<typeof historyService.backfill>[0]);
      return { inserted: count };
    }
  );

  // POST /api/v1/health-score-history/retention/apply — run retention sweep
  server.post(
    "/retention/apply",
    {
      schema: {
        tags: ["Health Score History"],
        summary: "Apply retention policies and prune old records",
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (_request, _reply) => {
      const deleted = await historyService.applyRetention();
      return { deleted };
    }
  );
}
