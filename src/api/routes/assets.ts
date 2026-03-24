import type { FastifyInstance } from "fastify";
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
  server.get("/", async (_request, _reply) => {
    // TODO: Fetch from database
    return { assets: [], total: 0 };
  });

  // Get detailed asset information
  server.get<{ Params: { symbol: string } }>(
    "/:symbol",
    async (request, _reply) => {
      const { symbol } = request.params;
      // TODO: Fetch asset details from database
      return { symbol, details: null };
    }
  );

  // Get current health score for an asset
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/health",
    async (request, _reply) => {
      const { symbol } = request.params;
      const health = await healthService.getHealthScore(symbol);
      return health;
    }
  );

  // Get aggregated liquidity data for an asset
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/liquidity",
    async (request, _reply) => {
      const { symbol } = request.params;
      const liquidity = await liquidityService.getAggregatedLiquidity(symbol);
      return liquidity;
    }
  );

  // Get current price from all sources
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/price",
    async (request, _reply) => {
      const { symbol } = request.params;
      const price = await priceService.getAggregatedPrice(symbol);
      return price;
    }
  );
}
