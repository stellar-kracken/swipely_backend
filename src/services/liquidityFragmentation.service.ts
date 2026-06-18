import { logger } from "../utils/logger.js";
import { CacheService, CacheTTL } from "../utils/cache.js";
import { getDatabase } from "../database/connection.js";
import { redis } from "../utils/redis.js";

const knex = getDatabase();

export interface FragmentationMetrics {
  symbol: string;
  totalLiquidity: number;
  dexCount: number;
  herfindahlIndex: number;
  giniCoefficient: number;
  concentrationRatio: number;
  fragmentationScore: number;
  timestamp: string;
}

export interface DexLiquidityShare {
  dex: string;
  liquidity: number;
  share: number;
  rank: number;
}

export interface OptimalRoute {
  fromAsset: string;
  toAsset: string;
  amount: number;
  routes: RouteStep[];
  estimatedOutput: number;
  estimatedSlippage: number;
  priceImpact: number;
  gasEstimate: number;
}

export interface RouteStep {
  dex: string;
  pair: string;
  inputAmount: number;
  outputAmount: number;
  price: number;
  liquidity: number;
  share: number;
}

export interface ArbitrageOpportunity {
  assetPair: string;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  spreadPercent: number;
  potentialProfit: number;
  estimatedVolume: number;
  confidence: number;
  timestamp: string;
}

export interface TrendAnalysis {
  symbol: string;
  period: string;
  fragmentationTrend: "increasing" | "decreasing" | "stable";
  changePercent: number;
  historicalData: Array<{
    timestamp: string;
    fragmentationScore: number;
    totalLiquidity: number;
  }>;
}

const SUPPORTED_DEXS = ["SDEX", "StellarX AMM", "Phoenix", "LumenSwap", "Soroswap"];

export class LiquidityFragmentationService {
  private static readonly MIN_LIQUIDITY_THRESHOLD = 100;
  private static readonly SLIPPAGE_TOLERANCE = 0.01;
  private static readonly MIN_ARBITRAGE_SPREAD = 0.005;

  private calculateHerfindahlIndex(shares: number[]): number {
    return shares.reduce((sum, share) => sum + Math.pow(share, 2), 0);
  }

  private calculateGiniCoefficient(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    let numerator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (2 * (i + 1) - n - 1) * sorted[i];
    }

    const mean = sorted.reduce((sum, val) => sum + val, 0) / n;
    return numerator / (n * n * mean);
  }

  private calculateFragmentationScore(
    herfindahl: number,
    gini: number,
    dexCount: number
  ): number {
    const herfindahlScore = (1 - herfindahl) * 100;
    const giniScore = gini * 100;
    const diversityScore = Math.min((dexCount / SUPPORTED_DEXS.length) * 100, 100);

    const fragmentationScore =
      herfindahlScore * 0.4 + giniScore * 0.4 + diversityScore * 0.2;

    return Math.round(fragmentationScore * 100) / 100;
  }

  async getFragmentationMetrics(
    symbol: string,
    bypassCache: boolean = false
  ): Promise<FragmentationMetrics | null> {
    const cacheKey = CacheService.generateKey("fragmentation", `metrics:${symbol}`);

    return CacheService.getOrSet(
      cacheKey,
      async () => {
        logger.info({ symbol }, "Computing liquidity fragmentation metrics");

        const liquidityData = await knex("liquidity_snapshots")
          .select("dex", knex.raw("AVG(tvl_usd::numeric) as avg_liquidity"))
          .where("symbol", symbol)
          .where("time", ">=", knex.raw("NOW() - INTERVAL '1 hour'"))
          .groupBy("dex")
          .orderBy("avg_liquidity", "desc");

        if (liquidityData.length === 0) {
          logger.warn({ symbol }, "No liquidity data found");
          return null;
        }

        const liquidities = liquidityData.map((d: any) =>
          parseFloat(d.avg_liquidity || "0")
        );
        const totalLiquidity = liquidities.reduce((sum, val) => sum + val, 0);

        if (totalLiquidity < LiquidityFragmentationService.MIN_LIQUIDITY_THRESHOLD) {
          return null;
        }

        const shares = liquidities.map((liq) => liq / totalLiquidity);
        const herfindahlIndex = this.calculateHerfindahlIndex(shares);
        const giniCoefficient = this.calculateGiniCoefficient(liquidities);
        const concentrationRatio = liquidities[0] / totalLiquidity;

        const fragmentationScore = this.calculateFragmentationScore(
          herfindahlIndex,
          giniCoefficient,
          liquidityData.length
        );

        return {
          symbol,
          totalLiquidity,
          dexCount: liquidityData.length,
          herfindahlIndex: Math.round(herfindahlIndex * 10000) / 10000,
          giniCoefficient: Math.round(giniCoefficient * 10000) / 10000,
          concentrationRatio: Math.round(concentrationRatio * 10000) / 10000,
          fragmentationScore,
          timestamp: new Date().toISOString(),
        };
      },
      { bypassCache, tags: ["fragmentation"], ttl: CacheTTL.ANALYTICS }
    );
  }

  async getDexLiquidityDistribution(
    symbol: string,
    bypassCache: boolean = false
  ): Promise<DexLiquidityShare[]> {
    const cacheKey = CacheService.generateKey("fragmentation", `distribution:${symbol}`);

    return CacheService.getOrSet(
      cacheKey,
      async () => {
        logger.info({ symbol }, "Computing DEX liquidity distribution");

        const liquidityData = await knex("liquidity_snapshots")
          .select("dex", knex.raw("AVG(tvl_usd::numeric) as avg_liquidity"))
          .where("symbol", symbol)
          .where("time", ">=", knex.raw("NOW() - INTERVAL '1 hour'"))
          .groupBy("dex")
          .orderBy("avg_liquidity", "desc");

        const totalLiquidity = liquidityData.reduce(
          (sum: number, d: any) => sum + parseFloat(d.avg_liquidity || "0"),
          0
        );

        return liquidityData.map((d: any, index: number) => {
          const liquidity = parseFloat(d.avg_liquidity || "0");
          return {
            dex: d.dex,
            liquidity,
            share: Math.round((liquidity / totalLiquidity) * 10000) / 100,
            rank: index + 1,
          };
        });
      },
      { bypassCache, tags: ["fragmentation"], ttl: CacheTTL.ANALYTICS }
    );
  }

  async calculateOptimalRoute(
    fromAsset: string,
    toAsset: string,
    amount: number
  ): Promise<OptimalRoute | null> {
    logger.info({ fromAsset, toAsset, amount }, "Calculating optimal routing");

    const liquidityData = await knex("liquidity_snapshots")
      .select("dex", "bid_depth", "ask_depth", "tvl_usd", "spread_pct")
      .where("symbol", fromAsset)
      .where("time", ">=", knex.raw("NOW() - INTERVAL '5 minutes'"))
      .orderBy("time", "desc");

    if (liquidityData.length === 0) {
      return null;
    }

    const dexes = new Map<
      string,
      { bidDepth: number; askDepth: number; tvl: number; spread: number }
    >();

    for (const row of liquidityData) {
      if (!dexes.has(row.dex)) {
        dexes.set(row.dex, {
          bidDepth: parseFloat(row.bid_depth || "0"),
          askDepth: parseFloat(row.ask_depth || "0"),
          tvl: parseFloat(row.tvl_usd || "0"),
          spread: parseFloat(row.spread_pct || "0"),
        });
      }
    }

    const routes: RouteStep[] = [];
    let remainingAmount = amount;
    let totalOutput = 0;

    const sortedDexes = Array.from(dexes.entries()).sort(
      ([, a], [, b]) => a.spread - b.spread
    );

    for (const [dex, data] of sortedDexes) {
      if (remainingAmount <= 0) break;

      const availableLiquidity = Math.min(data.askDepth, data.tvl * 0.1);
      if (availableLiquidity < LiquidityFragmentationService.MIN_LIQUIDITY_THRESHOLD) {
        continue;
      }

      const routeAmount = Math.min(remainingAmount, availableLiquidity);
      const priceImpact = this.estimatePriceImpact(routeAmount, data.tvl);
      const effectivePrice = 1 - data.spread / 100 - priceImpact;
      const outputAmount = routeAmount * effectivePrice;

      routes.push({
        dex,
        pair: `${fromAsset}/${toAsset}`,
        inputAmount: routeAmount,
        outputAmount,
        price: effectivePrice,
        liquidity: data.tvl,
        share: routeAmount / amount,
      });

      totalOutput += outputAmount;
      remainingAmount -= routeAmount;
    }

    if (routes.length === 0) {
      return null;
    }

    const estimatedSlippage = ((amount - totalOutput) / amount) * 100;
    const priceImpact = this.calculateAggregatedPriceImpact(routes, amount);

    return {
      fromAsset,
      toAsset,
      amount,
      routes,
      estimatedOutput: totalOutput,
      estimatedSlippage: Math.round(estimatedSlippage * 100) / 100,
      priceImpact: Math.round(priceImpact * 10000) / 10000,
      gasEstimate: routes.length * 100000,
    };
  }

  private estimatePriceImpact(amount: number, liquidity: number): number {
    if (liquidity === 0) return 1;
    const ratio = amount / liquidity;
    return Math.min(ratio * ratio * 0.5, 0.99);
  }

  private calculateAggregatedPriceImpact(routes: RouteStep[], totalAmount: number): number {
    if (routes.length === 0 || totalAmount === 0) return 0;

    const weightedImpact = routes.reduce((sum, route) => {
      const weight = route.inputAmount / totalAmount;
      const impact = this.estimatePriceImpact(route.inputAmount, route.liquidity);
      return sum + impact * weight;
    }, 0);

    return weightedImpact;
  }

  async detectArbitrageOpportunities(
    assetPairs?: string[],
    minSpread: number = LiquidityFragmentationService.MIN_ARBITRAGE_SPREAD
  ): Promise<ArbitrageOpportunity[]> {
    logger.info({ assetPairs, minSpread }, "Detecting arbitrage opportunities");

    const targetPairs = assetPairs || ["USDC/XLM", "EURC/XLM", "PYUSD/XLM"];
    const opportunities: ArbitrageOpportunity[] = [];

    for (const pair of targetPairs) {
      const [baseAsset] = pair.split("/");

      const priceData = await knex("liquidity_snapshots")
        .select("dex", "bid_depth", "ask_depth", "tvl_usd")
        .where("symbol", baseAsset)
        .where("time", ">=", knex.raw("NOW() - INTERVAL '2 minutes'"))
        .orderBy("time", "desc");

      if (priceData.length < 2) continue;

      const dexPrices = new Map<string, { bid: number; ask: number; tvl: number }>();

      for (const row of priceData) {
        if (!dexPrices.has(row.dex)) {
          const bidDepth = parseFloat(row.bid_depth || "0");
          const askDepth = parseFloat(row.ask_depth || "0");
          const tvl = parseFloat(row.tvl_usd || "0");

          if (bidDepth > 0 && askDepth > 0) {
            const midPrice = (bidDepth + askDepth) / 2;
            dexPrices.set(row.dex, {
              bid: midPrice * 0.999,
              ask: midPrice * 1.001,
              tvl,
            });
          }
        }
      }

      const dexList = Array.from(dexPrices.entries());

      for (let i = 0; i < dexList.length; i++) {
        for (let j = i + 1; j < dexList.length; j++) {
          const [dex1, prices1] = dexList[i];
          const [dex2, prices2] = dexList[j];

          const spread1 = prices2.bid - prices1.ask;
          const spread2 = prices1.bid - prices2.ask;

          if (spread1 > 0) {
            const spreadPercent = (spread1 / prices1.ask) * 100;
            if (spreadPercent >= minSpread * 100) {
              const volume = Math.min(prices1.tvl, prices2.tvl) * 0.01;
              opportunities.push({
                assetPair: pair,
                buyDex: dex1,
                sellDex: dex2,
                buyPrice: prices1.ask,
                sellPrice: prices2.bid,
                spread: Math.round(spread1 * 1000000) / 1000000,
                spreadPercent: Math.round(spreadPercent * 100) / 100,
                potentialProfit: spread1 * volume,
                estimatedVolume: volume,
                confidence: this.calculateConfidence(prices1.tvl, prices2.tvl),
                timestamp: new Date().toISOString(),
              });
            }
          }

          if (spread2 > 0) {
            const spreadPercent = (spread2 / prices2.ask) * 100;
            if (spreadPercent >= minSpread * 100) {
              const volume = Math.min(prices1.tvl, prices2.tvl) * 0.01;
              opportunities.push({
                assetPair: pair,
                buyDex: dex2,
                sellDex: dex1,
                buyPrice: prices2.ask,
                sellPrice: prices1.bid,
                spread: Math.round(spread2 * 1000000) / 1000000,
                spreadPercent: Math.round(spreadPercent * 100) / 100,
                potentialProfit: spread2 * volume,
                estimatedVolume: volume,
                confidence: this.calculateConfidence(prices2.tvl, prices1.tvl),
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }
    }

    opportunities.sort((a, b) => b.spreadPercent - a.spreadPercent);

    return opportunities;
  }

  private calculateConfidence(tvl1: number, tvl2: number): number {
    const minTvl = Math.min(tvl1, tvl2);
    const maxTvl = Math.max(tvl1, tvl2);

    if (maxTvl === 0) return 0;

    const liquidityBalance = minTvl / maxTvl;
    const tvlScore = Math.min(minTvl / 100000, 1);

    const confidence = (liquidityBalance * 0.6 + tvlScore * 0.4) * 100;

    return Math.round(confidence * 100) / 100;
  }

  async getFragmentationTrend(
    symbol: string,
    period: "24h" | "7d" | "30d" = "7d"
  ): Promise<TrendAnalysis | null> {
    logger.info({ symbol, period }, "Analyzing fragmentation trend");

    const intervalMap = {
      "24h": "1 hour",
      "7d": "1 day",
      "30d": "1 day",
    };

    const durationMap = {
      "24h": "24 hours",
      "7d": "7 days",
      "30d": "30 days",
    };

    const historicalData = await knex.raw(
      `
      WITH liquidity_buckets AS (
        SELECT
          time_bucket(?, time) as bucket,
          dex,
          AVG(tvl_usd::numeric) as avg_liquidity
        FROM liquidity_snapshots
        WHERE symbol = ?
          AND time >= NOW() - INTERVAL ?
        GROUP BY bucket, dex
      ),
      bucket_totals AS (
        SELECT
          bucket,
          SUM(avg_liquidity) as total_liquidity,
          COUNT(DISTINCT dex) as dex_count,
          ARRAY_AGG(avg_liquidity ORDER BY avg_liquidity DESC) as liquidities
        FROM liquidity_buckets
        GROUP BY bucket
      )
      SELECT
        bucket as timestamp,
        total_liquidity,
        dex_count,
        liquidities
      FROM bucket_totals
      ORDER BY bucket ASC
    `,
      [intervalMap[period], symbol, durationMap[period]]
    );

    if (!historicalData.rows || historicalData.rows.length === 0) {
      return null;
    }

    const dataPoints = historicalData.rows.map((row: any) => {
      const liquidities = row.liquidities || [];
      const totalLiquidity = parseFloat(row.total_liquidity || "0");
      const shares = liquidities.map((liq: number) => liq / totalLiquidity);

      const herfindahl = this.calculateHerfindahlIndex(shares);
      const gini = this.calculateGiniCoefficient(liquidities);
      const fragmentationScore = this.calculateFragmentationScore(
        herfindahl,
        gini,
        row.dex_count
      );

      return {
        timestamp: row.timestamp.toISOString(),
        fragmentationScore,
        totalLiquidity,
      };
    });

    if (dataPoints.length < 2) {
      return {
        symbol,
        period,
        fragmentationTrend: "stable",
        changePercent: 0,
        historicalData: dataPoints,
      };
    }

    const firstScore = dataPoints[0].fragmentationScore;
    const lastScore = dataPoints[dataPoints.length - 1].fragmentationScore;
    const changePercent = ((lastScore - firstScore) / firstScore) * 100;

    let trend: "increasing" | "decreasing" | "stable" = "stable";
    if (changePercent > 5) trend = "increasing";
    else if (changePercent < -5) trend = "decreasing";

    return {
      symbol,
      period,
      fragmentationTrend: trend,
      changePercent: Math.round(changePercent * 100) / 100,
      historicalData: dataPoints,
    };
  }

  async getCustomFragmentationAnalysis(query: {
    symbols?: string[];
    dexes?: string[];
    minLiquidity?: number;
    timeRange?: string;
  }): Promise<any> {
    logger.info({ query }, "Executing custom fragmentation analysis");

    const { symbols, dexes, minLiquidity, timeRange } = query;

    let baseQuery = knex("liquidity_snapshots")
      .select(
        "symbol",
        "dex",
        knex.raw("AVG(tvl_usd::numeric) as avg_liquidity"),
        knex.raw("AVG(spread_pct::numeric) as avg_spread"),
        knex.raw("COUNT(*) as sample_count")
      )
      .where("time", ">=", knex.raw(`NOW() - INTERVAL '${timeRange || "1 hour"}'`))
      .groupBy("symbol", "dex")
      .orderBy("avg_liquidity", "desc");

    if (symbols && symbols.length > 0) {
      baseQuery = baseQuery.whereIn("symbol", symbols);
    }

    if (dexes && dexes.length > 0) {
      baseQuery = baseQuery.whereIn("dex", dexes);
    }

    if (minLiquidity) {
      baseQuery = baseQuery.having(
        knex.raw("AVG(tvl_usd::numeric)"),
        ">=",
        minLiquidity
      );
    }

    const results = await baseQuery;

    const groupedBySymbol = results.reduce((acc: any, row: any) => {
      const symbol = row.symbol;
      if (!acc[symbol]) {
        acc[symbol] = [];
      }
      acc[symbol].push({
        dex: row.dex,
        avgLiquidity: parseFloat(row.avg_liquidity || "0"),
        avgSpread: parseFloat(row.avg_spread || "0"),
        sampleCount: parseInt(row.sample_count || "0"),
      });
      return acc;
    }, {});

    return groupedBySymbol;
  }

  async invalidateCache(symbol?: string): Promise<void> {
    logger.info({ symbol }, "Invalidating fragmentation cache");

    if (symbol) {
      await CacheService.invalidatePattern(
        CacheService.generateKey("fragmentation", `*:${symbol}`)
      );
    } else {
      await CacheService.invalidateByTag("fragmentation");
    }
  }
}
