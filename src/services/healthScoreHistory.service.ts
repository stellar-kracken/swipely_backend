import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export type TrendDirection = "improving" | "stable" | "deteriorating";
export type RecordSource = "scheduled" | "manual" | "backfill";

export interface HealthScoreHistoryRecord {
  id: string;
  symbol: string;
  overallScore: number;
  liquidityDepthScore: number;
  priceStabilityScore: number;
  bridgeUptimeScore: number;
  reserveBackingScore: number;
  volumeTrendScore: number;
  trend: TrendDirection;
  delta: number | null;
  source: RecordSource;
  recordedAt: string;
}

export interface HistoryQueryFilters {
  symbol: string;
  from?: Date;
  to?: Date;
  bucketInterval?: string; // e.g. '1 hour', '1 day'
  limit?: number;
  source?: RecordSource;
}

export interface AggregatedBucket {
  bucket: string;
  avgScore: number;
  minScore: number;
  maxScore: number;
  count: number;
}

export interface BackfillEntry {
  symbol: string;
  overallScore: number;
  liquidityDepthScore?: number;
  priceStabilityScore?: number;
  bridgeUptimeScore?: number;
  reserveBackingScore?: number;
  volumeTrendScore?: number;
  trend?: TrendDirection;
  recordedAt: Date;
}

export class HealthScoreHistoryService {
  private db = getDatabase();
  private table = "health_score_history";

  async record(
    symbol: string,
    scores: {
      overallScore: number;
      liquidityDepthScore: number;
      priceStabilityScore: number;
      bridgeUptimeScore: number;
      reserveBackingScore: number;
      volumeTrendScore: number;
      trend: TrendDirection;
    },
    source: RecordSource = "scheduled"
  ): Promise<HealthScoreHistoryRecord> {
    const previous = await this.db(this.table)
      .where("symbol", symbol)
      .orderBy("recorded_at", "desc")
      .first<{ overall_score: number } | undefined>();

    const delta = previous ? scores.overallScore - previous.overall_score : null;

    const [row] = await this.db(this.table)
      .insert({
        symbol,
        overall_score: scores.overallScore,
        liquidity_depth_score: scores.liquidityDepthScore,
        price_stability_score: scores.priceStabilityScore,
        bridge_uptime_score: scores.bridgeUptimeScore,
        reserve_backing_score: scores.reserveBackingScore,
        volume_trend_score: scores.volumeTrendScore,
        trend: scores.trend,
        delta,
        source,
        recorded_at: new Date(),
      })
      .returning("*");

    logger.debug({ symbol, overallScore: scores.overallScore, delta }, "Health score history recorded");
    return this.mapRow(row);
  }

  async getHistory(filters: HistoryQueryFilters): Promise<HealthScoreHistoryRecord[]> {
    const { symbol, from, to, limit = 500, source } = filters;

    const query = this.db(this.table)
      .where("symbol", symbol)
      .orderBy("recorded_at", "desc")
      .limit(limit);

    if (from) query.where("recorded_at", ">=", from);
    if (to) query.where("recorded_at", "<=", to);
    if (source) query.where("source", source);

    const rows = await query.select("*");
    return rows.map(this.mapRow);
  }

  async getAggregated(filters: HistoryQueryFilters): Promise<AggregatedBucket[]> {
    const { symbol, from, to, bucketInterval = "1 hour" } = filters;

    const fromDate = from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const toDate = to ?? new Date();

    const result = await this.db.raw<{ rows: Record<string, unknown>[] }>(
      `SELECT
         time_bucket(?, recorded_at) AS bucket,
         ROUND(AVG(overall_score))::int AS avg_score,
         MIN(overall_score) AS min_score,
         MAX(overall_score) AS max_score,
         COUNT(*) AS count
       FROM ${this.table}
       WHERE symbol = ? AND recorded_at BETWEEN ? AND ?
       GROUP BY bucket
       ORDER BY bucket DESC`,
      [bucketInterval, symbol, fromDate, toDate]
    );

    return result.rows.map((row) => ({
      bucket: String(row.bucket),
      avgScore: Number(row.avg_score),
      minScore: Number(row.min_score),
      maxScore: Number(row.max_score),
      count: Number(row.count),
    }));
  }

  async getTrend(symbol: string, windowHours = 24): Promise<{
    current: number;
    previous: number;
    delta: number;
    direction: TrendDirection;
  } | null> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
    const prevWindowStart = new Date(windowStart.getTime() - windowHours * 60 * 60 * 1000);

    const [currentRow] = await this.db(this.table)
      .where("symbol", symbol)
      .where("recorded_at", ">=", windowStart)
      .orderBy("recorded_at", "desc")
      .select("overall_score")
      .limit(1);

    const [prevRow] = await this.db(this.table)
      .where("symbol", symbol)
      .whereBetween("recorded_at", [prevWindowStart, windowStart])
      .orderBy("recorded_at", "desc")
      .select("overall_score")
      .limit(1);

    if (!currentRow) return null;

    const current = currentRow.overall_score as number;
    const previous = prevRow ? (prevRow.overall_score as number) : current;
    const delta = current - previous;
    const direction: TrendDirection =
      delta > 2 ? "improving" : delta < -2 ? "deteriorating" : "stable";

    return { current, previous, delta, direction };
  }

  async backfill(entries: BackfillEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    const rows = entries.map((e) => ({
      symbol: e.symbol,
      overall_score: e.overallScore,
      liquidity_depth_score: e.liquidityDepthScore ?? 0,
      price_stability_score: e.priceStabilityScore ?? 0,
      bridge_uptime_score: e.bridgeUptimeScore ?? 0,
      reserve_backing_score: e.reserveBackingScore ?? 0,
      volume_trend_score: e.volumeTrendScore ?? 0,
      trend: e.trend ?? "stable",
      delta: null,
      source: "backfill" as const,
      recorded_at: e.recordedAt,
    }));

    await this.db(this.table).insert(rows).onConflict().ignore();
    logger.info({ count: entries.length }, "Health score history backfilled");
    return entries.length;
  }

  async applyRetention(): Promise<number> {
    const policies = await this.db("health_score_retention_policies").select("*");
    let deleted = 0;

    for (const policy of policies) {
      const cutoff = new Date(
        Date.now() - (policy.retain_days as number) * 24 * 60 * 60 * 1000
      );
      const count = await this.db(this.table)
        .where("symbol", policy.symbol as string)
        .where("recorded_at", "<", cutoff)
        .delete();
      deleted += count;
    }

    // Default 90-day retention for symbols without a policy
    const defaultCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const policySymbols = policies.map((p) => p.symbol as string);

    const defaultDeleted = policySymbols.length
      ? await this.db(this.table)
          .whereNotIn("symbol", policySymbols)
          .where("recorded_at", "<", defaultCutoff)
          .delete()
      : await this.db(this.table).where("recorded_at", "<", defaultCutoff).delete();

    deleted += defaultDeleted;
    logger.info({ deleted }, "Health score retention applied");
    return deleted;
  }

  private mapRow(row: Record<string, unknown>): HealthScoreHistoryRecord {
    return {
      id: row.id as string,
      symbol: row.symbol as string,
      overallScore: row.overall_score as number,
      liquidityDepthScore: row.liquidity_depth_score as number,
      priceStabilityScore: row.price_stability_score as number,
      bridgeUptimeScore: row.bridge_uptime_score as number,
      reserveBackingScore: row.reserve_backing_score as number,
      volumeTrendScore: row.volume_trend_score as number,
      trend: row.trend as TrendDirection,
      delta: row.delta != null ? (row.delta as number) : null,
      source: row.source as RecordSource,
      recordedAt:
        row.recorded_at instanceof Date
          ? row.recorded_at.toISOString()
          : String(row.recorded_at),
    };
  }
}
