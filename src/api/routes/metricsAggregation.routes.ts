import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import {
  metricsAggregationService,
  type MetricDataPoint,
  type MetricGranularity,
} from "../../services/metricsAggregation.service.js";

const granularitySchema = z.enum(["hourly", "daily", "weekly"]);

const ingestBodySchema = z.object({
  points: z
    .array(
      z.object({
        metricKey: z.string().trim().min(1).max(120),
        value: z.number(),
        tags: z.record(z.unknown()).optional(),
        recordedAt: z.string().datetime().optional(),
      })
    )
    .min(1)
    .max(1000),
});

const retentionBodySchema = z.object({
  retentionDays: z.number().int().positive(),
});

export async function metricsAggregationRoutes(server: FastifyInstance) {
  const requireOps = authMiddleware({ requiredScopes: ["admin:config"] });

  server.post<{ Body: { points: MetricDataPoint[] } }>(
    "/ingest",
    {
      schema: {
        tags: ["Metrics Aggregation"],
        summary: "Ingest raw metric data points for aggregation",
        body: { type: "object", additionalProperties: true },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request: FastifyRequest<{ Body: { points: MetricDataPoint[] } }>, reply: FastifyReply) => {
      const body = ingestBodySchema.parse(request.body);
      const count = await metricsAggregationService.ingest(body.points);
      return reply.send({ ingested: count });
    }
  );

  server.get<{ Querystring: { metricKey?: string; granularity: MetricGranularity; from?: string; to?: string; limit?: string } }>(
    "/",
    {
      schema: {
        tags: ["Metrics Aggregation"],
        summary: "Query metric rollups by granularity and time range",
        querystring: {
          type: "object",
          required: ["granularity"],
          properties: {
            metricKey: { type: "string" },
            granularity: { type: "string", enum: ["hourly", "daily", "weekly"] },
            from: { type: "string" },
            to: { type: "string" },
            limit: { type: "string" },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const { metricKey, granularity, from, to, limit } = request.query;
      const rollups = await metricsAggregationService.getRollups({
        metricKey,
        granularity: granularitySchema.parse(granularity),
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return reply.send({ rollups, count: rollups.length });
    }
  );

  server.get<{ Querystring: { metricKey?: string; granularity: MetricGranularity; from?: string; to?: string; format?: "json" | "csv" } }>(
    "/export",
    {
      schema: {
        tags: ["Metrics Aggregation"],
        summary: "Export metric rollups as JSON or CSV",
        querystring: {
          type: "object",
          required: ["granularity"],
          properties: {
            metricKey: { type: "string" },
            granularity: { type: "string", enum: ["hourly", "daily", "weekly"] },
            from: { type: "string" },
            to: { type: "string" },
            format: { type: "string", enum: ["json", "csv"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { metricKey, granularity, from, to, format = "json" } = request.query;
      const exported = await metricsAggregationService.exportRollups(
        {
          metricKey,
          granularity: granularitySchema.parse(granularity),
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        },
        format
      );

      reply.header(
        "Content-Type",
        format === "csv" ? "text/csv" : "application/json"
      );
      return reply.send(exported);
    }
  );

  server.get(
    "/retention-policies",
    {
      schema: {
        tags: ["Metrics Aggregation"],
        summary: "List metric retention policies by granularity",
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (_request, reply) => {
      const policies = await metricsAggregationService.listRetentionPolicies();
      return reply.send({ policies });
    }
  );

  server.put<{ Params: { granularity: string }; Body: { retentionDays: number } }>(
    "/retention-policies/:granularity",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Metrics Aggregation"],
        summary: "Update the retention window for a granularity level",
        params: {
          type: "object",
          required: ["granularity"],
          properties: { granularity: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["retentionDays"],
          properties: { retentionDays: { type: "integer" } },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const body = retentionBodySchema.parse(request.body);
      const policy = await metricsAggregationService.setRetentionPolicy(
        request.params.granularity,
        body.retentionDays
      );
      return reply.send({ policy });
    }
  );

  server.post<{ Body: { granularity?: MetricGranularity } }>(
    "/run",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Metrics Aggregation"],
        summary: "Manually trigger a rollup run (all granularities if none specified)",
        body: {
          type: "object",
          properties: { granularity: { type: "string", enum: ["hourly", "daily", "weekly"] } },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const granularity = request.body?.granularity;
      if (granularity) {
        const windows = await metricsAggregationService.runRollup(granularitySchema.parse(granularity));
        return reply.send({ granularity, windows });
      }
      const results = await metricsAggregationService.runAllRollups();
      return reply.send({ results });
    }
  );
}
