import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { HealthService } from "../../services/health.service.js";
import { LiquidityService } from "../../services/liquidity.service.js";
import { PriceService } from "../../services/price.service.js";

// GET /api/v1/assets - List all monitored assets
// GET /api/v1/assets/:symbol - Detailed asset information
// GET /api/v1/assets/:symbol/health - Current health score
// GET /api/v1/assets/:symbol/liquidity - Aggregated liquidity data
// GET /api/v1/assets/:symbol/price - Current price from all sources

export async function assetsRoutes(server: FastifyInstance) {
  const healthService = new HealthService();
  const liquidityService = new LiquidityService();
  const priceService = new PriceService();

  // List all monitored assets
  server.get(
    "/",
    async (_request: FastifyRequest, _reply: FastifyReply) => {
    // TODO: Fetch from database
    return { assets: [], total: 0 };
    }
  );

  // Get detailed asset information
  server.get<{ Params: { symbol: string } }>(
    "/:symbol",
    async (
      request: FastifyRequest<{ Params: { symbol: string } }>,
      _reply: FastifyReply
    ) => {
      const { symbol } = request.params;
      // TODO: Fetch asset details from database
      return { symbol, details: null };
    }
  );

  // Get current health score for an asset
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/health",
    async (
      request: FastifyRequest<{ Params: { symbol: string } }>,
      _reply: FastifyReply
    ) => {
      const { symbol } = request.params;
      const health = await healthService.getHealthScore(symbol);
      return health;
    }
  );

  // Get historical health scores for sparklines
  server.get<{
    Params: { symbol: string };
    Querystring: { period?: "24h" | "7d" | "30d" };
  }>(
    "/:symbol/health/history",
    async (
      request: FastifyRequest<{
        Params: { symbol: string };
        Querystring: { period?: "24h" | "7d" | "30d" };
      }>,
      reply: FastifyReply
    ) => {
    const { symbol } = request.params;
    const period = request.query.period ?? "7d";

    const days = period === "24h" ? 1 : period === "30d" ? 30 : 7;

    if (!symbol) {
      return reply.status(400).send({ error: "Missing symbol" });
    }

    const points = await healthService.getHealthHistory(symbol, days);
    return { symbol, period, points };
    }
  );

  // Get aggregated liquidity data for an asset
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/liquidity",
    async (
      request: FastifyRequest<{ Params: { symbol: string } }>,
      _reply: FastifyReply
    ) => {
      const { symbol } = request.params;
      const liquidity = await liquidityService.getAggregatedLiquidity(symbol);
      return liquidity;
    }
  );

  // Get current price from all sources
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/price",
    async (
      request: FastifyRequest<{ Params: { symbol: string } }>,
      _reply: FastifyReply
    ) => {
      const { symbol } = request.params;
      const price = await priceService.getAggregatedPrice(symbol);
      return price;
    }
  );
}
