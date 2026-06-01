import type { FastifyInstance } from "fastify";
import { externalRateLimitMetricsService } from "../../services/externalRateLimitMetrics.service.js";

export async function externalRateLimitMetricsRoutes(server: FastifyInstance) {
  server.get(
    "/",
    {
      schema: {
        tags: ["Metrics"],
        summary: "Per-provider external rate limit usage snapshots",
        response: {
          200: {
            type: "object",
            properties: {
              providers: { type: "array", items: { type: "object", additionalProperties: true } },
              timestamp: { type: "string" },
            },
          },
        },
      },
    },
    async () => {
      const providers = await externalRateLimitMetricsService.getProviderSnapshots();
      return { providers, timestamp: new Date().toISOString() };
    },
  );

  server.get<{ Params: { providerKey: string }; Querystring: { hours?: number } }>(
    "/:providerKey/trend",
    {
      schema: {
        tags: ["Metrics"],
        summary: "Rate limit usage trend history for a provider",
        params: {
          type: "object",
          required: ["providerKey"],
          properties: { providerKey: { type: "string" } },
        },
        querystring: {
          type: "object",
          properties: { hours: { type: "integer", minimum: 1, maximum: 168, default: 24 } },
        },
      },
    },
    async (request) => {
      const trend = await externalRateLimitMetricsService.getTrend(
        request.params.providerKey,
        request.query.hours ?? 24,
      );
      return { providerKey: request.params.providerKey, trend };
    },
  );

  server.get(
    "/alerts",
    {
      schema: {
        tags: ["Metrics"],
        summary: "Active rate limit alert thresholds violations",
      },
    },
    async () => {
      const alerts = await externalRateLimitMetricsService.getAlerts();
      return { alerts, timestamp: new Date().toISOString() };
    },
  );

  server.get(
    "/export",
    {
      schema: {
        tags: ["Metrics"],
        summary: "Export external rate limit metrics",
      },
    },
    async () => externalRateLimitMetricsService.exportMetrics(),
  );

  server.put<{
    Params: { providerKey: string };
    Body: {
      usageWarningPct?: number;
      usageCriticalPct?: number;
      burstWarningCount?: number;
      enabled?: boolean;
    };
  }>(
    "/:providerKey/thresholds",
    {
      schema: {
        tags: ["Metrics"],
        summary: "Set alert thresholds for a provider",
        params: {
          type: "object",
          required: ["providerKey"],
          properties: { providerKey: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            usageWarningPct: { type: "integer", minimum: 1, maximum: 100 },
            usageCriticalPct: { type: "integer", minimum: 1, maximum: 100 },
            burstWarningCount: { type: "integer", minimum: 1 },
            enabled: { type: "boolean" },
          },
        },
      },
    },
    async (request) => {
      await externalRateLimitMetricsService.setAlertThreshold(
        request.params.providerKey,
        request.body,
      );
      return { message: "Thresholds updated" };
    },
  );

  server.post<{
    Body: {
      providerKey: string;
      requestsCount?: number;
      throttled?: boolean;
      burst?: boolean;
      limitRemaining?: number;
      limitTotal?: number;
      resetAtEpoch?: number;
      details?: Record<string, unknown>;
    };
  }>(
    "/record",
    {
      schema: {
        tags: ["Metrics"],
        summary: "Record provider rate limit usage (internal)",
        body: {
          type: "object",
          required: ["providerKey"],
          properties: {
            providerKey: { type: "string" },
            requestsCount: { type: "integer" },
            throttled: { type: "boolean" },
            burst: { type: "boolean" },
            limitRemaining: { type: "integer" },
            limitTotal: { type: "integer" },
            resetAtEpoch: { type: "integer" },
            details: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      await externalRateLimitMetricsService.recordUsage(request.body);
      return reply.status(201).send({ recorded: true });
    },
  );
}
