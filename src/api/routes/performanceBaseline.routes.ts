import type { FastifyInstance } from "fastify";
import { performanceBaselineService } from "../../services/performanceBaseline.service.js";
import type { PerformanceSample } from "../../services/performanceBaseline.service.js";

export async function performanceBaselineRoutes(server: FastifyInstance) {
  server.get(
    "/",
    {
      schema: {
        tags: ["Performance Baselines"],
        summary: "List latest performance baselines for all tracked endpoints",
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (_req, reply) => {
      const baselines = await performanceBaselineService.getLatestBaselines();
      return reply.send({ baselines, count: baselines.length });
    }
  );

  server.get<{ Querystring: { endpoint: string; method?: string; limit?: string } }>(
    "/trend",
    {
      schema: {
        tags: ["Performance Baselines"],
        summary: "Get historical p95 trend for an endpoint",
        querystring: {
          type: "object",
          required: ["endpoint"],
          properties: {
            endpoint: { type: "string" },
            method: { type: "string" },
            limit: { type: "string" },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const { endpoint, method = "GET", limit } = request.query;
      const trend = await performanceBaselineService.getTrend(endpoint, method, limit ? Number(limit) : 30);
      return reply.send(trend);
    }
  );

  server.post<{ Body: { samples: PerformanceSample[] } }>(
    "/record",
    {
      schema: {
        tags: ["Performance Baselines"],
        summary: "Record performance samples and update baselines",
        body: {
          type: "object",
          required: ["samples"],
          properties: {
            samples: {
              type: "array",
              items: {
                type: "object",
                required: ["endpoint", "method", "durationMs", "statusCode"],
                properties: {
                  endpoint: { type: "string" },
                  method: { type: "string" },
                  durationMs: { type: "number" },
                  statusCode: { type: "number" },
                  sampledAt: { type: "string" },
                },
              },
            },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const baselines = await performanceBaselineService.recordBaseline(request.body.samples);
      const regressions = await performanceBaselineService.detectRegressions(request.body.samples);
      return reply.send({ baselines, regressions, regressionCount: regressions.length });
    }
  );

  server.post<{ Body: { samples: PerformanceSample[] } }>(
    "/detect-regressions",
    {
      schema: {
        tags: ["Performance Baselines"],
        summary: "Check samples for regressions against stored baselines",
        body: {
          type: "object",
          required: ["samples"],
          properties: {
            samples: {
              type: "array",
              items: {
                type: "object",
                required: ["endpoint", "method", "durationMs", "statusCode"],
                properties: {
                  endpoint: { type: "string" },
                  method: { type: "string" },
                  durationMs: { type: "number" },
                  statusCode: { type: "number" },
                },
              },
            },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const regressions = await performanceBaselineService.detectRegressions(request.body.samples);
      return reply.send({ regressions, regressionCount: regressions.length });
    }
  );
}
