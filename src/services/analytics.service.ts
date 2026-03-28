import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { redis } from "../utils/redis.js";

const knex = getDatabase();

export type TimeInterval = "1h" | "1d" | "1w" | "1M";
export type AggregationPeriod = "hourly" | "daily" | "weekly" | "monthly";

export interface ProtocolStats {
  totalValueLocked: string;
  totalVolume24h: string;
  totalVolume7d: string;
  totalVolume30d: string;
  activeBridges: number;
  activeAssets: number;
  totalTransactions24h: number;
  averageHealthScore: number;
  timestamp: Date;
}

export interface BridgeComparison {
  bridgeName: string;
  tvl: string;
  volume24h: string;
  volume7d: string;
  volume30d: string;
  transactionCount: number;
  averageTransactionSize: string;
  status: string;
  marketShare: number;
  trend: "up" | "down" | "stable";
  changePercent24h: number;
}

export interface AssetRanking {
  symbol: string;
  rank: number;
  tvl: string;
  volume24h: string;
  healthScore: number;
  priceStability: number;
  liquidityDepth: string;
  bridgeCount: number;
  trend: "up" | "down" | "stable";
  changePercent24h: number;
}

export interface VolumeAggregation {
  period: string;
  totalVolume: string;
  inflowVolume: string;
  outflowVolume: string;
  netFlow: string;
  transactionCount: number;
  averageTransactionSize: string;
  peakVolume: string;
  peakTimestamp: Date | null;
}

export interface TrendData {
  metric: string;
  current: number;
  previous: number;
  change: number;
  changePercent: number;
  trend: "up" | "down" | "stable";
}

export interface CustomMetric {
  id: string;
  name: string;
  description: string;
  query: string;
  parameters: Record<string, any>;
  cacheKey: string;
  cacheTTL: number;
}

export class AnalyticsService {
  private readonly CACHE_PREFIX = "analytics:";
  private readonly DEFAULT_CACHE_TTL = 300; // 5 minutes

  /**
   * Get protocol-wide statistics
   */
  async getProtocolStats(): Promise<ProtocolStats> {
    const cacheKey = `${this.CACHE_PREFIX}protocol:stats`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      logger.debug("Returning cached protocol stats");
      return JSON.parse(cached);
    }

    logger.info("Computing protocol-wide statistics");

    const [tvlResult, volumeResult, bridgeResult, assetResult, txResult, healthResult] = await Promise.all([
      // Total Value Locked
      knex("bridges")
        .sum("total_value_locked as total")
        .where("is_active", true)
        .first(),
      
      // Volume aggregations
      knex("bridge_volume_stats")
        .select(
          knex.raw("SUM(inflow_amount + outflow_amount) as volume_24h"),
          knex.raw("SUM(CASE WHEN stat_date >= CURRENT_DATE - INTERVAL '7 days' THEN inflow_amount + outflow_amount ELSE 0 END) as volume_7d"),
          knex.raw("SUM(CASE WHEN stat_date >= CURRENT_DATE - INTERVAL '30 days' THEN inflow_amount + outflow_amount ELSE 0 END) as volume_30d")
        )
        .where("stat_date", ">=", knex.raw("CURRENT_DATE - INTERVAL '30 days'"))
        .first(),
      
      // Active bridges
      knex("bridges")
        .count("* as count")
        .where("is_active", true)
        .first(),
      
      // Active assets
      knex("assets")
        .count("* as count")
        .where("is_active", true)
        .first(),
      
      // Transaction count (24h)
      knex("bridge_volume_stats")
        .sum("tx_count as total")
        .where("stat_date", ">=", knex.raw("CURRENT_DATE - INTERVAL '1 day'"))
        .first(),
      
      // Average health score
      knex("health_scores")
        .avg("overall_score as avg")
        .where("time", ">=", knex.raw("NOW() - INTERVAL '1 hour'"))
        .first(),
    ]);

    const stats: ProtocolStats = {
      totalValueLocked: tvlResult?.total || "0",
      totalVolume24h: volumeResult?.volume_24h || "0",
      totalVolume7d: volumeResult?.volume_7d || "0",
      totalVolume30d: volumeResult?.volume_30d || "0",
      activeBridges: Number(bridgeResult?.count || 0),
      activeAssets: Number(assetResult?.count || 0),
      totalTransactions24h: Number(txResult?.total || 0),
      averageHealthScore: Math.round(Number(healthResult?.avg || 0)),
      timestamp: new Date(),
    };

    await redis.setex(cacheKey, this.DEFAULT_CACHE_TTL, JSON.stringify(stats));
    return stats;
  }

  /**
   * Get bridge comparison metrics
   */
  async getBridgeComparisons(): Promise<BridgeComparison[]> {
    const cacheKey = `${this.CACHE_PREFIX}bridges:comparison`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      logger.debug("Returning cached bridge comparisons");
      return JSON.parse(cached);
    }

    logger.info("Computing bridge comparison metrics");

    const bridges = await knex("bridges")
      .select("*")
      .where("is_active", true);

    const totalTVL = bridges.reduce((sum: number, b: any) => sum + parseFloat(b.total_value_locked), 0);

    const comparisons: BridgeComparison[] = await Promise.all(
      bridges.map(async (bridge: any) => {
        const [volumeStats, previousVolume] = await Promise.all([
          knex("bridge_volume_stats")
            .select(
              knex.raw("SUM(inflow_amount + outflow_amount) as volume_24h"),
              knex.raw("SUM(CASE WHEN stat_date >= CURRENT_DATE - INTERVAL '7 days' THEN inflow_amount + outflow_amount ELSE 0 END) as volume_7d"),
              knex.raw("SUM(CASE WHEN stat_date >= CURRENT_DATE - INTERVAL '30 days' THEN inflow_amount + outflow_amount ELSE 0 END) as volume_30d"),
              knex.raw("SUM(tx_count) as tx_count"),
              knex.raw("AVG(avg_tx_size) as avg_tx_size")
            )
            .where("bridge_name", bridge.name)
            .where("stat_date", ">=", knex.raw("CURRENT_DATE - INTERVAL '30 days'"))
            .first(),
          
          knex("bridge_volume_stats")
            .sum("inflow_amount as total")
            .sum("outflow_amount as total_out")
            .where("bridge_name", bridge.name)
            .where("stat_date", ">=", knex.raw("CURRENT_DATE - INTERVAL '2 days'"))
            .where("stat_date", "<", knex.raw("CURRENT_DATE - INTERVAL '1 day'"))
            .first(),
        ]);

        const currentVolume = parseFloat(volumeStats?.volume_24h || "0");
        const prevVolume = parseFloat(previousVolume?.total || "0") + parseFloat(previousVolume?.total_out || "0");
        const changePercent = prevVolume > 0 ? ((currentVolume - prevVolume) / prevVolume) * 100 : 0;

        return {
          bridgeName: bridge.name,
          tvl: bridge.total_value_locked,
          volume24h: volumeStats?.volume_24h || "0",
          volume7d: volumeStats?.volume_7d || "0",
          volume30d: volumeStats?.volume_30d || "0",
          transactionCount: Number(volumeStats?.tx_count || 0),
          averageTransactionSize: volumeStats?.avg_tx_size || "0",
          status: bridge.status,
          marketShare: totalTVL > 0 ? (parseFloat(bridge.total_value_locked) / totalTVL) * 100 : 0,
          trend: changePercent > 1 ? "up" : changePercent < -1 ? "down" : "stable",
          changePercent24h: changePercent,
        };
      })
    );

    // Sort by TVL descending
    comparisons.sort((a, b) => parseFloat(b.tvl) - parseFloat(a.tvl));

    await redis.setex(cacheKey, this.DEFAULT_CACHE_TTL, JSON.stringify(comparisons));
    return comparisons;
  }

  /**
   * Get asset rankings
   */
  async getAssetRankings(): Promise<AssetRanking[]> {
    const cacheKey = `${this.CACHE_PREFIX}assets:rankings`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      logger.debug("Returning cached asset rankings");
      return JSON.parse(cached);
    }

    logger.info("Computing asset rankings");

    const assets = await knex("assets")
      .select("*")
      .where("is_active", true);

    const rankings: AssetRanking[] = await Promise.all(
      assets.map(async (asset: any) => {
        const [liquidityData, volumeData, healthData, previousHealth, bridgeCount] = await Promise.all([
          knex("liquidity_snapshots")
            .sum("tvl_usd as total_tvl")
            .where("symbol", asset.symbol)
            .where("time", ">=", knex.raw("NOW() - INTERVAL '1 hour'"))
            .first(),
          
          knex("bridge_volume_stats")
            .sum("inflow_amount as inflow")
            .sum("outflow_amount as outflow")
            .where("symbol", asset.symbol)
            .where("stat_date", ">=", knex.raw("CURRENT_DATE - INTERVAL '1 day'"))
            .first(),
          
          knex("health_scores")
            .select("overall_score", "price_stability_score")
            .where("symbol", asset.symbol)
            .where("time", ">=", knex.raw("NOW() - INTERVAL '1 hour'"))
            .orderBy("time", "desc")
            .first(),
          
          knex("health_scores")
            .select("overall_score")
            .where("symbol", asset.symbol)
            .where("time", ">=", knex.raw("NOW() - INTERVAL '25 hours'"))
            .where("time", "<", knex.raw("NOW() - INTERVAL '23 hours'"))
            .orderBy("time", "desc")
            .first(),
          
          knex("bridge_volume_stats")
            .countDistinct("bridge_name as count")
            .where("symbol", asset.symbol)
            .where("stat_date", ">=", knex.raw("CURRENT_DATE - INTERVAL '7 days'"))
            .first(),
        ]);

        const currentHealth = healthData?.overall_score || 0;
        const prevHealth = previousHealth?.overall_score || currentHealth;
        const changePercent = prevHealth > 0 ? ((currentHealth - prevHealth) / prevHealth) * 100 : 0;

        return {
          symbol: asset.symbol,
          rank: 0, // Will be set after sorting
          tvl: liquidityData?.total_tvl || "0",
          volume24h: String(parseFloat(volumeData?.inflow || "0") + parseFloat(volumeData?.outflow || "0")),
          healthScore: currentHealth,
          priceStability: healthData?.price_stability_score || 0,
          liquidityDepth: liquidityData?.total_tvl || "0",
          bridgeCount: Number(bridgeCount?.count || 0),
          trend: changePercent > 1 ? "up" : changePercent < -1 ? "down" : "stable",
          changePercent24h: changePercent,
        };
      })
    );

    // Sort by health score and assign ranks
    rankings.sort((a, b) => b.healthScore - a.healthScore);
    rankings.forEach((ranking, index) => {
      ranking.rank = index + 1;
    });

    await redis.setex(cacheKey, this.DEFAULT_CACHE_TTL, JSON.stringify(rankings));
    return rankings;
  }

  /**
   * Get volume aggregations for a specific period
   */
  async getVolumeAggregation(
    period: AggregationPeriod,
    symbol?: string,
    bridgeName?: string
  ): Promise<VolumeAggregation[]> {
    const cacheKey = `${this.CACHE_PREFIX}volume:${period}:${symbol || "all"}:${bridgeName || "all"}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      logger.debug({ period, symbol, bridgeName }, "Returning cached volume aggregation");
      return JSON.parse(cached);
    }

    logger.info({ period, symbol, bridgeName }, "Computing volume aggregation");

    const intervalMap: Record<AggregationPeriod, string> = {
      hourly: "1 hour",
      daily: "1 day",
      weekly: "1 week",
      monthly: "1 month",
    };

    const query = knex("bridge_volume_stats")
      .select(
        knex.raw(`time_bucket('${intervalMap[period]}', stat_date::timestamp) as period`),
        knex.raw("SUM(inflow_amount + outflow_amount) as total_volume"),
        knex.raw("SUM(inflow_amount) as inflow_volume"),
        knex.raw("SUM(outflow_amount) as outflow_volume"),
        knex.raw("SUM(net_flow) as net_flow"),
        knex.raw("SUM(tx_count) as transaction_count"),
        knex.raw("AVG(avg_tx_size) as average_transaction_size"),
        knex.raw("MAX(inflow_amount + outflow_amount) as peak_volume")
      )
      .groupBy("period")
      .orderBy("period", "desc")
      .limit(100);

    if (symbol) {
      query.where("symbol", symbol);
    }

    if (bridgeName) {
      query.where("bridge_name", bridgeName);
    }

    const results = await query;

    const aggregations: VolumeAggregation[] = results.map((row: any) => ({
      period: row.period,
      totalVolume: row.total_volume || "0",
      inflowVolume: row.inflow_volume || "0",
      outflowVolume: row.outflow_volume || "0",
      netFlow: row.net_flow || "0",
      transactionCount: Number(row.transaction_count || 0),
      averageTransactionSize: row.average_transaction_size || "0",
      peakVolume: row.peak_volume || "0",
      peakTimestamp: null,
    }));

    await redis.setex(cacheKey, this.DEFAULT_CACHE_TTL, JSON.stringify(aggregations));
    return aggregations;
  }

  /**
   * Calculate trend for a specific metric
   */
  async calculateTrend(
    metric: string,
    symbol?: string,
    bridgeName?: string
  ): Promise<TrendData> {
    logger.info({ metric, symbol, bridgeName }, "Calculating trend");

    let currentValue = 0;
    let previousValue = 0;

    switch (metric) {
      case "health_score":
        if (!symbol) throw new Error("Symbol required for health_score metric");
        const [current, previous] = await Promise.all([
          knex("health_scores")
            .avg("overall_score as value")
            .where("symbol", symbol)
            .where("time", ">=", knex.raw("NOW() - INTERVAL '1 hour'"))
            .first(),
          knex("health_scores")
            .avg("overall_score as value")
            .where("symbol", symbol)
            .where("time", ">=", knex.raw("NOW() - INTERVAL '25 hours'"))
            .where("time", "<", knex.raw("NOW() - INTERVAL '24 hours'"))
            .first(),
        ]);
        currentValue = Number(current?.value || 0);
        previousValue = Number(previous?.value || 0);
        break;

      case "tvl":
        if (bridgeName) {
          const bridge = await knex("bridges")
            .select("total_value_locked")
            .where("name", bridgeName)
            .first();
          currentValue = parseFloat(bridge?.total_value_locked || "0");
          // For simplicity, using current as previous (would need historical tracking)
          previousValue = currentValue * 0.95;
        } else {
          const result = await knex("bridges")
            .sum("total_value_locked as total")
            .where("is_active", true)
            .first();
          currentValue = parseFloat(result?.total || "0");
          previousValue = currentValue * 0.95;
        }
        break;

      case "volume":
        const volumeQuery = knex("bridge_volume_stats")
          .sum("inflow_amount as inflow")
          .sum("outflow_amount as outflow");
        
        if (symbol) volumeQuery.where("symbol", symbol);
        if (bridgeName) volumeQuery.where("bridge_name", bridgeName);

        const [currentVol, previousVol] = await Promise.all([
          volumeQuery.clone().where("stat_date", ">=", knex.raw("CURRENT_DATE - INTERVAL '1 day'")).first(),
          volumeQuery.clone()
            .where("stat_date", ">=", knex.raw("CURRENT_DATE - INTERVAL '2 days'"))
            .where("stat_date", "<", knex.raw("CURRENT_DATE - INTERVAL '1 day'"))
            .first(),
        ]);

        currentValue = parseFloat(currentVol?.inflow || "0") + parseFloat(currentVol?.outflow || "0");
        previousValue = parseFloat(previousVol?.inflow || "0") + parseFloat(previousVol?.outflow || "0");
        break;

      default:
        throw new Error(`Unknown metric: ${metric}`);
    }

    const change = currentValue - previousValue;
    const changePercent = previousValue > 0 ? (change / previousValue) * 100 : 0;

    return {
      metric,
      current: currentValue,
      previous: previousValue,
      change,
      changePercent,
      trend: changePercent > 1 ? "up" : changePercent < -1 ? "down" : "stable",
    };
  }

  /**
   * Get top performers (assets or bridges)
   */
  async getTopPerformers(
    type: "assets" | "bridges",
    metric: "volume" | "tvl" | "health",
    limit: number = 10
  ): Promise<any[]> {
    const cacheKey = `${this.CACHE_PREFIX}top:${type}:${metric}:${limit}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      logger.debug({ type, metric, limit }, "Returning cached top performers");
      return JSON.parse(cached);
    }

    logger.info({ type, metric, limit }, "Computing top performers");

    let results: any[] = [];

    if (type === "assets") {
      const rankings = await this.getAssetRankings();
      
      switch (metric) {
        case "volume":
          results = rankings
            .sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h))
            .slice(0, limit);
          break;
        case "tvl":
          results = rankings
            .sort((a, b) => parseFloat(b.tvl) - parseFloat(a.tvl))
            .slice(0, limit);
          break;
        case "health":
          results = rankings.slice(0, limit); // Already sorted by health
          break;
      }
    } else {
      const comparisons = await this.getBridgeComparisons();
      
      switch (metric) {
        case "volume":
          results = comparisons
            .sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h))
            .slice(0, limit);
          break;
        case "tvl":
          results = comparisons.slice(0, limit); // Already sorted by TVL
          break;
        default:
          results = comparisons.slice(0, limit);
      }
    }

    await redis.setex(cacheKey, this.DEFAULT_CACHE_TTL, JSON.stringify(results));
    return results;
  }

  /**
   * Execute custom metric query
   */
  async executeCustomMetric(metric: CustomMetric): Promise<any> {
    const cacheKey = `${this.CACHE_PREFIX}custom:${metric.cacheKey}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      logger.debug({ metricId: metric.id }, "Returning cached custom metric");
      return JSON.parse(cached);
    }

    logger.info({ metricId: metric.id, name: metric.name }, "Executing custom metric");

    try {
      const result = await knex.raw(metric.query, metric.parameters);
      const data = result.rows || result;

      await redis.setex(cacheKey, metric.cacheTTL || this.DEFAULT_CACHE_TTL, JSON.stringify(data));
      return data;
    } catch (error) {
      logger.error({ metricId: metric.id, error }, "Failed to execute custom metric");
      throw error;
    }
  }

  /**
   * Invalidate cache for specific keys or patterns
   */
  async invalidateCache(pattern?: string): Promise<void> {
    logger.info({ pattern }, "Invalidating analytics cache");

    if (pattern) {
      const keys = await redis.keys(`${this.CACHE_PREFIX}${pattern}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } else {
      const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  }

  /**
   * Get historical comparison data
   */
  async getHistoricalComparison(
    metric: string,
    symbol?: string,
    days: number = 30
  ): Promise<{ date: string; value: number }[]> {
    logger.info({ metric, symbol, days }, "Fetching historical comparison");

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query;

    switch (metric) {
      case "health_score":
        if (!symbol) throw new Error("Symbol required for health_score metric");
        query = knex("health_scores")
          .select(
            knex.raw("DATE(time) as date"),
            knex.raw("AVG(overall_score) as value")
          )
          .where("symbol", symbol)
          .where("time", ">=", startDate)
          .groupBy("date")
          .orderBy("date", "asc");
        break;

      case "volume":
        query = knex("bridge_volume_stats")
          .select(
            knex.raw("stat_date as date"),
            knex.raw("SUM(inflow_amount + outflow_amount) as value")
          )
          .where("stat_date", ">=", startDate);
        
        if (symbol) query.where("symbol", symbol);
        
        query.groupBy("date").orderBy("date", "asc");
        break;

      case "liquidity":
        if (!symbol) throw new Error("Symbol required for liquidity metric");
        query = knex("liquidity_snapshots")
          .select(
            knex.raw("DATE(time) as date"),
            knex.raw("AVG(tvl_usd::numeric) as value")
          )
          .where("symbol", symbol)
          .where("time", ">=", startDate)
          .groupBy("date")
          .orderBy("date", "asc");
        break;

      default:
        throw new Error(`Unknown metric: ${metric}`);
    }

    const results = await query;
    return results.map((row: any) => ({
      date: row.date instanceof Date ? row.date.toISOString().split("T")[0] : row.date,
      value: parseFloat(row.value || "0"),
    }));
  }
}
