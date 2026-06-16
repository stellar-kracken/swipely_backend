import type { FastifyInstance } from "fastify";
import { stringify } from "csv-stringify/sync";
import { getUsageMetricsService } from "../../services/usageMetrics.service.js";
import { authMiddleware } from "../middleware/auth.js";

export async function usageMetricsRoutes(server: FastifyInstance) {
  const svc = getUsageMetricsService();

  server.get(
    "/admin/usage-metrics",
    {
      preHandler: authMiddleware({ requiredScopes: ["admin"] }),
      schema: {
        tags: ["Metrics"],
        summary: "Query usage metrics aggregates",
        querystring: {
          type: "object",
          properties: {
            start: { type: "string" },
            end: { type: "string" },
            groupBy: { type: "string", enum: ["endpoint", "user_id"] },
            rollup: { type: "string", enum: ["hour", "day"] },
            format: { type: "string", enum: ["json", "csv"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { start, end, groupBy = "endpoint", rollup = "hour", format = "json" } = request.query as any;
      const rows = await svc.queryAggregates({ start, end, groupBy, rollup });
      if (format === "csv") {
        const csv = stringify(rows, { header: true });
        reply.type("text/csv");
        return csv;
      }
      return rows;
    }
  );
}
