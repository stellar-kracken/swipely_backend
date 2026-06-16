import type { FastifyInstance } from "fastify";
import { provenanceService } from "../../services/provenance.service.js";

export async function provenanceRoutes(server: FastifyInstance) {
  server.get<{
    Querystring: { asset?: string; bridge?: string; metric?: string };
  }>(
    "/",
    {
      schema: {
        tags: ["Provenance"],
        summary: "List available metric lineage entries",
        description:
          "Returns a summary list of metrics for which provenance graphs are available. Filterable by asset, bridge, or metric type.",
        querystring: {
          type: "object",
          properties: {
            asset: { type: "string", description: "Filter by asset symbol, e.g. USDC" },
            bridge: { type: "string", description: "Filter by bridge name, e.g. Allbridge" },
            metric: { type: "string", description: "Filter by metric type, e.g. price, health, tvl" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              metrics: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { asset, bridge, metric } = request.query;
      const metrics = provenanceService.listMetrics({
        asset: asset || undefined,
        bridge: bridge || undefined,
        metric: metric || undefined,
      });
      return { metrics };
    },
  );

  server.get<{
    Querystring: { metric: string; asset?: string; bridge?: string };
  }>(
    "/lineage",
    {
      schema: {
        tags: ["Provenance"],
        summary: "Get full provenance graph for a metric",
        description:
          "Returns source, transform, and destination nodes with edges representing the full data pipeline lineage for a given metric. Includes freshness markers on each node.",
        querystring: {
          type: "object",
          required: ["metric"],
          properties: {
            metric: {
              type: "string",
              description: "Metric type (price, health, tvl, alerts)",
              example: "price",
            },
            asset: {
              type: "string",
              description: "Asset symbol to scope the lineage to",
              example: "USDC",
            },
            bridge: {
              type: "string",
              description: "Bridge name to scope the lineage to",
              example: "Allbridge",
            },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { metric, asset, bridge } = request.query;
      const graph = provenanceService.getLineage(metric, asset, bridge);
      if (!graph) {
        return reply.code(404).send({ error: "No provenance graph found for the given parameters" });
      }
      return graph;
    },
  );
}
