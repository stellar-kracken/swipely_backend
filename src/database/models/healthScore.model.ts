import { getDatabase } from "../connection.js";

export interface HealthScoreRecord {
  time: Date;
  symbol: string;
  overall_score: number;
  liquidity_depth_score: number;
  price_stability_score: number;
  bridge_uptime_score: number;
  reserve_backing_score: number;
  volume_trend_score: number;
}

export class HealthScoreModel {
  private db = getDatabase();
  private table = "health_scores";

  async insert(data: HealthScoreRecord): Promise<void> {
    await this.db(this.table).insert(data);
  }

  async getLatest(symbol: string): Promise<HealthScoreRecord | undefined> {
    return this.db(this.table)
      .where("symbol", symbol)
      .orderBy("time", "desc")
      .first();
  }

  /**
   * Get time-bucketed health scores using TimescaleDB time_bucket
   */
  async getTimeBucketed(
    symbol: string,
    bucketInterval: string,
    startTime: Date
  ): Promise<{ bucket: Date; avg_score: number }[]> {
    const result = await this.db.raw(
      `SELECT time_bucket(?, time) AS bucket, AVG(overall_score) AS avg_score
       FROM health_scores
       WHERE symbol = ? AND time >= ?
       GROUP BY bucket
       ORDER BY bucket DESC`,
      [bucketInterval, symbol, startTime]
    );

    const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
    return rows.map((row: any) => ({
      bucket: row.bucket instanceof Date ? row.bucket : new Date(row.bucket),
      avg_score:
        typeof row.avg_score === "number" ? row.avg_score : Number(row.avg_score),
    }));
  }

  /**
   * Get the latest health scores for all monitored assets
   */
  async getLatestForAll(): Promise<HealthScoreRecord[]> {
    const result = await this.db.raw(
      `SELECT DISTINCT ON (symbol) *
       FROM health_scores
       ORDER BY symbol, time DESC`
    );

    return ((result as unknown as { rows?: HealthScoreRecord[] }).rows ?? [])
      .map((row) => ({
        ...row,
        time: row.time instanceof Date ? row.time : new Date(row.time),
      }));
  }
}
