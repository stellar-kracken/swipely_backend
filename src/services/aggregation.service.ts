/**
 * Data Aggregation Service
 * Aggregates data from multiple sources and time periods for efficient analytics
 */

import { getDatabase } from "../database/connection";
import { logger } from "../utils/logger";
import { redis } from "../utils/redis";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PriceAggregation {
  symbol: string;
  interval: string;
  period_start: Date;
  period_end: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  avg: string;
  volume: string;
  count: number;
}

export interface HealthScoreAggregation {
  symbol: string;
  interval: string;
  period_start: Date;
  period_end: Date;
  avg_overall_score: number;
  avg_liquidity_score: number;
  avg_price_stability_score: number;
  avg_bridge_uptime_score: number;
  avg_reserve_backing_score: number;
  avg_volume_trend_score: number;
  min_overall_score: number;
  max_overall_score: number;
  count: number;
}

export interface VolumeAggregation {
  symbol: string;
  interval: string;
  period_start: Date;
  period_end: Date;
  total_volume: string;
  avg_volume: string;
  tx_count: number;
}

export type AggregationInterval = "1h" | "4h" | "1d" | "1w" | "1M";

// ─── Aggregation Service ─────────────────────────────────────────────────────

export class AggregationService {
  /**
   * Aggregate price data by interval
   */
  async aggregatePrices(
    symbol: string,
    interval: AggregationInterval,
    startTime: Date,
    endTime: Date,
  ): Promise<PriceAggregation[]> {
    const cacheKey = `agg:price:${symbol}:${interval}:${startTime.getTime()}:${endTime.getTime()}`;

    try {
      // Check cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const db = getDatabase();
      const intervalSeconds = this.getIntervalSeconds(interval);

      const results = await db.raw(
        `
        SELECT 
          symbol,
          '${interval}' as interval,
          time_bucket('${intervalSeconds} seconds', time) as period_start,
          time_bucket('${intervalSeconds} seconds', time) + interval '${intervalSeconds} seconds' as period_end,
          FIRST(price, time) as open,
          MAX(price) as high,
          MIN(price) as low,
          LAST(price, time) as close,
          AVG(price) as avg,
          SUM(COALESCE(volume_24h, 0)) as volume,
          COUNT(*) as count
        FROM prices
        WHERE symbol = ? AND time >= ? AND time <= ?
        GROUP BY symbol, period_start
        ORDER BY period_start DESC
      `,
        [symbol, startTime, endTime],
      );

      const aggregations = results.rows;

      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(aggregations));

      logger.debug(
        { symbol, interval, count: aggregations.length },
        "Prices aggregated",
      );
      return aggregations;
    } catch (error) {
      logger.error({ error, symbol, interval }, "Failed to aggregate prices");
      return [];
    }
  }

  /**
   * Aggregate health scores by period
   */
  async aggregateHealthScores(
    symbol: string,
    interval: AggregationInterval,
    startTime: Date,
    endTime: Date,
  ): Promise<HealthScoreAggregation[]> {
    const cacheKey = `agg:health:${symbol}:${interval}:${startTime.getTime()}:${endTime.getTime()}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const db = getDatabase();
      const intervalSeconds = this.getIntervalSeconds(interval);

      const results = await db.raw(
        `
        SELECT 
          symbol,
          '${interval}' as interval,
          time_bucket('${intervalSeconds} seconds', time) as period_start,
          time_bucket('${intervalSeconds} seconds', time) + interval '${intervalSeconds} seconds' as period_end,
          AVG(overall_score) as avg_overall_score,
          AVG(liquidity_depth_score) as avg_liquidity_score,
          AVG(price_stability_score) as avg_price_stability_score,
          AVG(bridge_uptime_score) as avg_bridge_uptime_score,
          AVG(reserve_backing_score) as avg_reserve_backing_score,
          AVG(volume_trend_score) as avg_volume_trend_score,
          MIN(overall_score) as min_overall_score,
          MAX(overall_score) as max_overall_score,
          COUNT(*) as count
        FROM health_scores
        WHERE symbol = ? AND time >= ? AND time <= ?
        GROUP BY symbol, period_start
        ORDER BY period_start DESC
      `,
        [symbol, startTime, endTime],
      );

      const aggregations = results.rows;

      await redis.setex(cacheKey, 300, JSON.stringify(aggregations));

      logger.debug(
        { symbol, interval, count: aggregations.length },
        "Health scores aggregated",
      );
      return aggregations;
    } catch (error) {
      logger.error(
        { error, symbol, interval },
        "Failed to aggregate health scores",
      );
      return [];
    }
  }

  /**
   * Aggregate volume data
   */
  async aggregateVolume(
    symbol: string,
    interval: AggregationInterval,
    startTime: Date,
    endTime: Date,
  ): Promise<VolumeAggregation[]> {
    const cacheKey = `agg:volume:${symbol}:${interval}:${startTime.getTime()}:${endTime.getTime()}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const db = getDatabase();
      const intervalSeconds = this.getIntervalSeconds(interval);

      const results = await db.raw(
        `
        SELECT 
          symbol,
          '${interval}' as interval,
          time_bucket('${intervalSeconds} seconds', time) as period_start,
          time_bucket('${intervalSeconds} seconds', time) + interval '${intervalSeconds} seconds' as period_end,
          SUM(COALESCE(volume_24h_usd, 0)) as total_volume,
          AVG(COALESCE(volume_24h_usd, 0)) as avg_volume,
          COUNT(*) as tx_count
        FROM liquidity_snapshots
        WHERE symbol = ? AND time >= ? AND time <= ?
        GROUP BY symbol, period_start
        ORDER BY period_start DESC
      `,
        [symbol, startTime, endTime],
      );

      const aggregations = results.rows;

      await redis.setex(cacheKey, 300, JSON.stringify(aggregations));

      logger.debug(
        { symbol, interval, count: aggregations.length },
        "Volume aggregated",
      );
      return aggregations;
    } catch (error) {
      logger.error({ error, symbol, interval }, "Failed to aggregate volume");
      return [];
    }
  }

  /**
   * Pre-compute aggregations for all assets
   */
  async preComputeAggregations(interval: AggregationInterval): Promise<void> {
    const db = getDatabase();

    try {
      // Get all active assets
      const assets = await db("assets")
        .where({ is_active: true })
        .select("symbol");

      const endTime = new Date();
      const startTime = new Date(
        endTime.getTime() - this.getIntervalMilliseconds(interval) * 100,
      );

      for (const asset of assets) {
        await this.aggregatePrices(asset.symbol, interval, startTime, endTime);
        await this.aggregateHealthScores(
          asset.symbol,
          interval,
          startTime,
          endTime,
        );
        await this.aggregateVolume(asset.symbol, interval, startTime, endTime);
      }

      logger.info(
        { interval, assetCount: assets.length },
        "Pre-computed aggregations",
      );
    } catch (error) {
      logger.error({ error, interval }, "Failed to pre-compute aggregations");
    }
  }

  /**
   * Rebuild historical aggregations
   */
  async rebuildHistoricalAggregations(
    symbol: string,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    try {
      const intervals: AggregationInterval[] = ["1h", "4h", "1d", "1w", "1M"];

      for (const interval of intervals) {
        // Clear cache
        const pattern = `agg:*:${symbol}:${interval}:*`;
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }

        // Rebuild
        await this.aggregatePrices(symbol, interval, startDate, endDate);
        await this.aggregateHealthScores(symbol, interval, startDate, endDate);
        await this.aggregateVolume(symbol, interval, startDate, endDate);
      }

      logger.info(
        { symbol, startDate, endDate },
        "Rebuilt historical aggregations",
      );
    } catch (error) {
      logger.error(
        { error, symbol },
        "Failed to rebuild historical aggregations",
      );
      throw error;
    }
  }

  /**
   * Get multi-asset aggregation
   */
  async getMultiAssetAggregation(
    symbols: string[],
    interval: AggregationInterval,
    startTime: Date,
    endTime: Date,
  ): Promise<Record<string, PriceAggregation[]>> {
    const results: Record<string, PriceAggregation[]> = {};

    await Promise.all(
      symbols.map(async (symbol) => {
        results[symbol] = await this.aggregatePrices(
          symbol,
          interval,
          startTime,
          endTime,
        );
      }),
    );

    return results;
  }

  /**
   * Cleanup old aggregation cache
   */
  async cleanupOldCache(olderThanDays: number = 7): Promise<void> {
    try {
      const pattern = "agg:*";
      const keys = await redis.keys(pattern);

      let deletedCount = 0;
      for (const key of keys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1 || ttl > 86400 * olderThanDays) {
          await redis.del(key);
          deletedCount++;
        }
      }

      logger.info(
        { deletedCount, olderThanDays },
        "Cleaned up old aggregation cache",
      );
    } catch (error) {
      logger.error({ error }, "Failed to cleanup old cache");
    }
  }

  /**
   * Get aggregation statistics
   */
  async getAggregationStats(): Promise<{
    cachedAggregations: number;
    cacheSize: string;
    intervals: Record<AggregationInterval, number>;
  }> {
    try {
      const pattern = "agg:*";
      const keys = await redis.keys(pattern);

      const intervals: Record<AggregationInterval, number> = {
        "1h": 0,
        "4h": 0,
        "1d": 0,
        "1w": 0,
        "1M": 0,
      };

      for (const key of keys) {
        for (const interval of Object.keys(
          intervals,
        ) as AggregationInterval[]) {
          if (key.includes(`:${interval}:`)) {
            intervals[interval]++;
          }
        }
      }

      return {
        cachedAggregations: keys.length,
        cacheSize: `${(keys.length * 1024).toFixed(2)} KB (estimated)`,
        intervals,
      };
    } catch (error) {
      logger.error({ error }, "Failed to get aggregation stats");
      return {
        cachedAggregations: 0,
        cacheSize: "0 KB",
        intervals: { "1h": 0, "4h": 0, "1d": 0, "1w": 0, "1M": 0 },
      };
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private getIntervalSeconds(interval: AggregationInterval): number {
    const map: Record<AggregationInterval, number> = {
      "1h": 3600,
      "4h": 14400,
      "1d": 86400,
      "1w": 604800,
      "1M": 2592000,
    };
    return map[interval];
  }

  private getIntervalMilliseconds(interval: AggregationInterval): number {
    return this.getIntervalSeconds(interval) * 1000;
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const aggregationService = new AggregationService();
