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
    return this.db.raw(
      `SELECT time_bucket(?, time) AS bucket, AVG(overall_score) AS avg_score
       FROM health_scores
       WHERE symbol = ? AND time >= ?
       GROUP BY bucket
       ORDER BY bucket DESC`,
      [bucketInterval, symbol, startTime]
    );
  }

  /**
   * Get the latest health scores for all monitored assets
   */
  async getLatestForAll(): Promise<HealthScoreRecord[]> {
    return this.db.raw(
      `SELECT DISTINCT ON (symbol) *
       FROM health_scores
       ORDER BY symbol, time DESC`
    );
  }
}
