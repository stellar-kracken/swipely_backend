import type { FastifyInstance, FastifyRequest } from "fastify";
import { savedMetricService } from "../../services/savedMetric.service.js";
import { logger } from "../../utils/logger.js";

function getRequestUserId(request: FastifyRequest): string {
  return request.apiKeyAuth?.id ?? "00000000-0000-0000-0000-000000000000";
}

export async function savedMetricsRoutes(server: FastifyInstance) {
  server.get(
    "/",
    {
      schema: {
        tags: ["Analytics"],
        summary: "List saved custom metrics",
      },
    },
    async (request, reply) => {
      try {
        const metrics = await savedMetricService.listMetrics(getRequestUserId(request));
        return reply.send({ success: true, data: metrics });
      } catch (error) {
        logger.error({ error }, "Failed to list saved metrics");
        return reply.status(500).send({ success: false, error: "Failed to list saved metrics" });
      }
    },
  );

  server.post<{ Body: { name: string; description?: string; formula: string; isShared?: boolean; cacheTtl?: number } }>(
    "/",
    {
      schema: {
        tags: ["Analytics"],
        summary: "Create a saved custom metric",
        body: {
          type: "object",
          required: ["name", "formula"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            formula: { type: "string" },
            isShared: { type: "boolean" },
            cacheTtl: { type: "integer" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const metric = await savedMetricService.createMetric({
          ...request.body,
          createdBy: getRequestUserId(request),
        });
        return reply.status(201).send({ success: true, data: metric });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create metric";
        return reply.status(400).send({ success: false, error: message });
      }
    },
  );

  server.post<{ Body: { formula: string } }>(
    "/validate",
    {
      schema: {
        tags: ["Analytics"],
        summary: "Validate and preview a metric formula",
        body: {
          type: "object",
          required: ["formula"],
          properties: { formula: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await savedMetricService.previewFormula(request.body.formula);
        return reply.send({ success: result.valid, data: result });
      } catch (error) {
        logger.error({ error }, "Metric validation failed");
        return reply.status(500).send({ success: false, error: "Validation failed" });
      }
    },
  );

  server.get<{ Params: { id: string }; Querystring: { forceRefresh?: string } }>(
    "/:id/execute",
    {
      schema: {
        tags: ["Analytics"],
        summary: "Execute a saved custom metric",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const result = await savedMetricService.executeSavedMetric(
        request.params.id,
        getRequestUserId(request),
        request.query.forceRefresh === "true",
      );
      if (!result) return reply.status(404).send({ success: false, error: "Metric not found" });
      return reply.send({ success: true, data: result });
    },
  );

  server.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/:id",
    {
      schema: {
        tags: ["Analytics"],
        summary: "Update a saved custom metric",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      try {
        const updated = await savedMetricService.updateMetric(
          request.params.id,
          getRequestUserId(request),
          request.body as Parameters<typeof savedMetricService.updateMetric>[2],
        );
        if (!updated) return reply.status(404).send({ success: false, error: "Metric not found" });
        return reply.send({ success: true, data: updated });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update metric";
        return reply.status(400).send({ success: false, error: message });
      }
    },
  );

  server.delete<{ Params: { id: string } }>(
    "/:id",
    {
      schema: {
        tags: ["Analytics"],
        summary: "Delete a saved custom metric",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const deleted = await savedMetricService.deleteMetric(
        request.params.id,
        getRequestUserId(request),
      );
      if (!deleted) return reply.status(404).send({ success: false, error: "Metric not found" });
      return reply.send({ success: true });
    },
  );
}
