import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { assetLifecycleService } from "../../services/assetLifecycle.service.js";

interface DeactivateBody {
  reason?: string | null;
  performedBy: string;
}

interface ReactivateBody {
  performedBy: string;
}

export async function assetsLifecycleRoutes(server: FastifyInstance) {
  // Deactivate an asset
  server.post<{ Params: { symbol: string }; Body: DeactivateBody }>(
    "/assets/:symbol/deactivate",
    async (request: FastifyRequest<{ Params: { symbol: string }; Body: DeactivateBody }>, reply: FastifyReply) => {
      try {
        const { symbol } = request.params;
        const { reason, performedBy } = request.body;

        const result = await assetLifecycleService.deactivateAsset(symbol, reason, performedBy);

        if (!result.success) {
          return reply.code(400).send({ error: result.error });
        }

        return reply.code(200).send({ success: true, message: `Asset ${symbol} deactivated successfully` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to deactivate asset";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // Reactivate an asset
  server.post<{ Params: { symbol: string }; Body: ReactivateBody }>(
    "/assets/:symbol/reactivate",
    async (request: FastifyRequest<{ Params: { symbol: string }; Body: ReactivateBody }>, reply: FastifyReply) => {
      try {
        const { symbol } = request.params;
        const { performedBy } = request.body;

        const result = await assetLifecycleService.reactivateAsset(symbol, performedBy);

        if (!result.success) {
          return reply.code(400).send({ error: result.error });
        }

        return reply.code(200).send({ success: true, message: `Asset ${symbol} reactivated successfully` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to reactivate asset";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // Get lifecycle events for an asset
  server.get<{ Params: { symbol: string }; Querystring: { limit?: number } }>(
    "/assets/:symbol/lifecycle",
    async (request: FastifyRequest<{ Params: { symbol: string }; Querystring: { limit?: number } }>, reply: FastifyReply) => {
      try {
        const { symbol } = request.params;
        const limit = request.query.limit || 50;

        const events = await assetLifecycleService.getLifecycleEvents(symbol, limit);
        return { symbol, events };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get lifecycle events";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // Get all deactivated assets
  server.get("/assets/deactivated", async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const assets = await assetLifecycleService.getDeactivatedAssets();
      return { assets, total: assets.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get deactivated assets";
      return reply.code(500).send({ error: message });
    }
  });
}
