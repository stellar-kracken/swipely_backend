import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { LiquidityFragmentationService } from "../../services/liquidityFragmentation.service.js";
import { logger } from "../../utils/logger.js";

const service = new LiquidityFragmentationService();

interface MetricsParams {
  symbol: string;
}

interface RouteQueryParams {
  fromAsset: string;
  toAsset: string;
  amount: string;
}

interface ArbitrageQueryParams {
  pairs?: string;
  minSpread?: string;
}

interface TrendParams {
  symbol: string;
}

interface TrendQuery {
  period?: "24h" | "7d" | "30d";
}

interface CustomAnalysisQuery {
  symbols?: string;
  dexes?: string;
  minLiquidity?: string;
  timeRange?: string;
}

export async function liquidityFragmentationRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: MetricsParams; Querystring: { bypassCache?: string } }>(
    "/fragmentation/metrics/:symbol",
    {
      schema: {
        description: "Get liquidity fragmentation metrics for an asset",
        tags: ["fragmentation"],
        params: {
          type: "object",
          required: ["symbol"],
          properties: {
            symbol: { type: "string", description: "Asset symbol" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            bypassCache: { type: "string", enum: ["true", "false"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              totalLiquidity: { type: "number" },
              dexCount: { type: "number" },
              herfindahlIndex: { type: "number" },
              giniCoefficient: { type: "number" },
              concentrationRatio: { type: "number" },
              fragmentationScore: { type: "number" },
              timestamp: { type: "string" },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: MetricsParams; Querystring: { bypassCache?: string } }>, reply: FastifyReply) => {
      try {
        const { symbol } = request.params;
        const bypassCache = request.query.bypassCache === "true";

        const metrics = await service.getFragmentationMetrics(symbol.toUpperCase(), bypassCache);

        if (!metrics) {
          return reply.code(404).send({ error: "No fragmentation data available" });
        }

        return reply.send(metrics);
      } catch (error) {
        logger.error({ error }, "Failed to get fragmentation metrics");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  fastify.get<{ Params: MetricsParams; Querystring: { bypassCache?: string } }>(
    "/fragmentation/distribution/:symbol",
    {
      schema: {
        description: "Get DEX liquidity distribution for an asset",
        tags: ["fragmentation"],
        params: {
          type: "object",
          required: ["symbol"],
          properties: {
            symbol: { type: "string", description: "Asset symbol" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            bypassCache: { type: "string", enum: ["true", "false"] },
          },
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                dex: { type: "string" },
                liquidity: { type: "number" },
                share: { type: "number" },
                rank: { type: "number" },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: MetricsParams; Querystring: { bypassCache?: string } }>, reply: FastifyReply) => {
      try {
        const { symbol } = request.params;
        const bypassCache = request.query.bypassCache === "true";

        const distribution = await service.getDexLiquidityDistribution(symbol.toUpperCase(), bypassCache);

        return reply.send(distribution);
      } catch (error) {
        logger.error({ error }, "Failed to get liquidity distribution");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  fastify.get<{ Querystring: RouteQueryParams }>(
    "/fragmentation/optimal-route",
    {
      schema: {
        description: "Calculate optimal trade route for large orders",
        tags: ["fragmentation"],
        querystring: {
          type: "object",
          required: ["fromAsset", "toAsset", "amount"],
          properties: {
            fromAsset: { type: "string", description: "Source asset symbol" },
            toAsset: { type: "string", description: "Destination asset symbol" },
            amount: { type: "string", description: "Trade amount" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              fromAsset: { type: "string" },
              toAsset: { type: "string" },
              amount: { type: "number" },
              routes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    dex: { type: "string" },
                    pair: { type: "string" },
                    inputAmount: { type: "number" },
                    outputAmount: { type: "number" },
                    price: { type: "number" },
                    liquidity: { type: "number" },
                    share: { type: "number" },
                  },
                },
              },
              estimatedOutput: { type: "number" },
              estimatedSlippage: { type: "number" },
              priceImpact: { type: "number" },
              gasEstimate: { type: "number" },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: RouteQueryParams }>, reply: FastifyReply) => {
      try {
        const { fromAsset, toAsset, amount } = request.query;

        const route = await service.calculateOptimalRoute(
          fromAsset.toUpperCase(),
          toAsset.toUpperCase(),
          parseFloat(amount)
        );

        if (!route) {
          return reply.code(404).send({ error: "No route available" });
        }

        return reply.send(route);
      } catch (error) {
        logger.error({ error }, "Failed to calculate optimal route");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  fastify.get<{ Querystring: ArbitrageQueryParams }>(
    "/fragmentation/arbitrage",
    {
      schema: {
        description: "Detect arbitrage opportunities across DEXs",
        tags: ["fragmentation"],
        querystring: {
          type: "object",
          properties: {
            pairs: { type: "string", description: "Comma-separated asset pairs (e.g., USDC/XLM,EURC/XLM)" },
            minSpread: { type: "string", description: "Minimum spread threshold (default: 0.005)" },
          },
        },
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                assetPair: { type: "string" },
                buyDex: { type: "string" },
                sellDex: { type: "string" },
                buyPrice: { type: "number" },
                sellPrice: { type: "number" },
                spread: { type: "number" },
                spreadPercent: { type: "number" },
                potentialProfit: { type: "number" },
                estimatedVolume: { type: "number" },
                confidence: { type: "number" },
                timestamp: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: ArbitrageQueryParams }>, reply: FastifyReply) => {
      try {
        const { pairs, minSpread } = request.query;

        const assetPairs = pairs ? pairs.split(",") : undefined;
        const spread = minSpread ? parseFloat(minSpread) : undefined;

        const opportunities = await service.detectArbitrageOpportunities(assetPairs, spread);

        return reply.send(opportunities);
      } catch (error) {
        logger.error({ error }, "Failed to detect arbitrage opportunities");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  fastify.get<{ Params: TrendParams; Querystring: TrendQuery }>(
    "/fragmentation/trend/:symbol",
    {
      schema: {
        description: "Get fragmentation trend analysis",
        tags: ["fragmentation"],
        params: {
          type: "object",
          required: ["symbol"],
          properties: {
            symbol: { type: "string", description: "Asset symbol" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            period: { type: "string", enum: ["24h", "7d", "30d"], description: "Analysis period" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              period: { type: "string" },
              fragmentationTrend: { type: "string", enum: ["increasing", "decreasing", "stable"] },
              changePercent: { type: "number" },
              historicalData: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    timestamp: { type: "string" },
                    fragmentationScore: { type: "number" },
                    totalLiquidity: { type: "number" },
                  },
                },
              },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: TrendParams; Querystring: TrendQuery }>, reply: FastifyReply) => {
      try {
        const { symbol } = request.params;
        const { period = "7d" } = request.query;

        const trend = await service.getFragmentationTrend(symbol.toUpperCase(), period);

        if (!trend) {
          return reply.code(404).send({ error: "No trend data available" });
        }

        return reply.send(trend);
      } catch (error) {
        logger.error({ error }, "Failed to get fragmentation trend");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  fastify.post<{ Body: CustomAnalysisQuery }>(
    "/fragmentation/custom-analysis",
    {
      schema: {
        description: "Execute custom fragmentation analysis with filters",
        tags: ["fragmentation"],
        body: {
          type: "object",
          properties: {
            symbols: { type: "string", description: "Comma-separated asset symbols" },
            dexes: { type: "string", description: "Comma-separated DEX names" },
            minLiquidity: { type: "string", description: "Minimum liquidity threshold" },
            timeRange: { type: "string", description: "Time range (e.g., '1 hour', '24 hours')" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CustomAnalysisQuery }>, reply: FastifyReply) => {
      try {
        const { symbols, dexes, minLiquidity, timeRange } = request.body;

        const query = {
          symbols: symbols ? symbols.split(",").map(s => s.trim().toUpperCase()) : undefined,
          dexes: dexes ? dexes.split(",").map(d => d.trim()) : undefined,
          minLiquidity: minLiquidity ? parseFloat(minLiquidity) : undefined,
          timeRange,
        };

        const results = await service.getCustomFragmentationAnalysis(query);

        return reply.send(results);
      } catch (error) {
        logger.error({ error }, "Failed to execute custom analysis");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  fastify.delete<{ Params: { symbol?: string } }>(
    "/fragmentation/cache/:symbol?",
    {
      schema: {
        description: "Invalidate fragmentation cache",
        tags: ["fragmentation"],
        params: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Optional asset symbol to invalidate specific cache" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { symbol?: string } }>, reply: FastifyReply) => {
      try {
        const { symbol } = request.params;

        await service.invalidateCache(symbol?.toUpperCase());

        return reply.send({
          message: symbol
            ? `Cache invalidated for ${symbol}`
            : "All fragmentation cache invalidated",
        });
      } catch (error) {
        logger.error({ error }, "Failed to invalidate cache");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
