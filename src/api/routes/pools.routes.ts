import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PoolService } from "../../services/pool.service.js";
import { logger } from "../../utils/logger.js";

const poolService = new PoolService();

export async function poolRoutes(server: FastifyInstance) {
  // Get all liquidity pools
  server.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const pools = await poolService.getAllPools();
      return { success: true, data: pools };
    } catch (error) {
      logger.error(error, "Failed to fetch pools");
      reply.code(500);
      return { success: false, error: "Failed to fetch pools" };
    }
  });

  // Get pools for a specific asset pair
  server.get(
    "/pair/:assetA/:assetB",
    async (
      request: FastifyRequest<{
        Params: { assetA: string; assetB: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { assetA, assetB } = request.params;
        const pools = await poolService.getPoolsForPair(assetA, assetB);
        return { success: true, data: pools };
      } catch (error) {
        logger.error(error, "Failed to fetch pools for pair");
        reply.code(500);
        return { success: false, error: "Failed to fetch pools for pair" };
      }
    }
  );

  // Get detailed metrics for a specific pool
  server.get(
    "/:poolId/metrics",
    async (
      request: FastifyRequest<{
        Params: { poolId: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { poolId } = request.params;
        const metrics = await poolService.getPoolMetrics(poolId);
        
        if (!metrics) {
          reply.code(404);
          return { success: false, error: "Pool not found" };
        }
        
        return { success: true, data: metrics };
      } catch (error) {
        logger.error(error, "Failed to fetch pool metrics");
        reply.code(500);
        return { success: false, error: "Failed to fetch pool metrics" };
      }
    }
  );

  // Compare pools across DEXes for the same pair
  server.get(
    "/compare/:assetA/:assetB",
    async (
      request: FastifyRequest<{
        Params: { assetA: string; assetB: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { assetA, assetB } = request.params;
        const comparison = await poolService.comparePools(assetA, assetB);
        
        if (!comparison) {
          reply.code(404);
          return { success: false, error: "No pools found for this pair" };
        }
        
        return { success: true, data: comparison };
      } catch (error) {
        logger.error(error, "Failed to compare pools");
        reply.code(500);
        return { success: false, error: "Failed to compare pools" };
      }
    }
  );

  // Get recent pool events
  server.get(
    "/:poolId/events",
    async (
      request: FastifyRequest<{
        Params: { poolId: string };
        Querystring: { limit?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { poolId } = request.params;
        const limit = request.query.limit ? parseInt(request.query.limit) : 50;
        const events = await poolService.getPoolEvents(poolId, limit);
        return { success: true, data: events };
      } catch (error) {
        logger.error(error, "Failed to fetch pool events");
        reply.code(500);
        return { success: false, error: "Failed to fetch pool events" };
      }
    }
  );

  // Get large liquidity events
  server.get(
    "/events/large",
    async (
      request: FastifyRequest<{
        Querystring: { threshold?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const threshold = request.query.threshold 
          ? parseFloat(request.query.threshold) 
          : 0.1;
        const events = await poolService.detectLargeLiquidityEvents(threshold);
        return { success: true, data: events };
      } catch (error) {
        logger.error(error, "Failed to detect large liquidity events");
        reply.code(500);
        return { success: false, error: "Failed to detect large liquidity events" };
      }
    }
  );

  // Health check for pool monitoring
  server.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const pools = await poolService.getAllPools();
      const healthyPools = pools.filter(pool => pool.healthScore >= 70);
      
      return {
        success: true,
        data: {
          totalPools: pools.length,
          healthyPools: healthyPools.length,
          systemHealth: pools.length > 0 ? (healthyPools.length / pools.length) * 100 : 100,
          lastUpdated: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error(error, "Pool health check failed");
      reply.code(500);
      return { success: false, error: "Pool health check failed" };
    }
  });
}
