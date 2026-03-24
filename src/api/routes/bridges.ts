import type { FastifyInstance } from "fastify";
import { BridgeService } from "../../services/bridge.service.js";

// GET /api/v1/bridges - Bridge status overview
// GET /api/v1/bridges/:bridge/stats - Bridge-specific statistics

export async function bridgesRoutes(server: FastifyInstance) {
  const bridgeService = new BridgeService();

  // Bridge status overview
  server.get("/", async (_request, _reply) => {
    const bridges = await bridgeService.getAllBridgeStatuses();
    return bridges;
  });

  // Bridge-specific statistics
  server.get<{ Params: { bridge: string } }>(
    "/:bridge/stats",
    async (request, _reply) => {
      const { bridge } = request.params;
      const stats = await bridgeService.getBridgeStats(bridge);
      return stats;
    }
  );
}
