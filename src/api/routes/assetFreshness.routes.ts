import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { assetFreshnessService } from "../../services/assetFreshness.service.js";

interface SummaryQuery {
  bypassCache?: boolean;
}

interface AssetParams {
  symbol: string;
}

export async function assetFreshnessRoutes(server: FastifyInstance) {
  server.get<{ Querystring: SummaryQuery }>(
    "/",
    {
      schema: {
        tags: ["AssetFreshness"],
        summary: "Get rolled-up freshness summary for all assets",
        querystring: {
          type: "object",
          properties: {
            bypassCache: { type: "boolean", default: false },
          },
        },
        response: {
          200: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: SummaryQuery }>) => {
      const bypass = String(request.query.bypassCache ?? "false") === "true";
      const summary = await assetFreshnessService.getSummary({ bypassCache: bypass });
      return summary;
    }
  );

  server.get<{ Params: AssetParams }>(
    "/:symbol",
    {
      schema: {
        tags: ["AssetFreshness"],
        summary: "Get per-source freshness for a single asset (symbol)",
        params: {
          type: "object",
          properties: {
            symbol: { type: "string" },
          },
          required: ["symbol"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request: FastifyRequest<{ Params: AssetParams }>, reply: FastifyReply) => {
      const symbol = request.params.symbol;
      const detail = await assetFreshnessService.getAssetDetail(symbol);
      if (!detail) return reply.status(404).send({ error: "Asset not found" });
      return detail;
    }
  );
}
