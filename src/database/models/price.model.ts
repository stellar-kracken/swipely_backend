import { getDatabase } from "../connection.js";

export interface PriceRecord {
  time: Date;
  symbol: string;
  source: string;
  price: number;
  volume_24h: number | null;
}

export class PriceModel {
  private db = getDatabase();
  private table = "prices";

  async insert(data: PriceRecord): Promise<void> {
    await this.db(this.table).insert(data);
  }

  async insertBatch(records: PriceRecord[]): Promise<void> {
    await this.db(this.table).insert(records);
  }

  async getLatest(symbol: string): Promise<PriceRecord[]> {
    return this.db(this.table)
      .where("symbol", symbol)
      .orderBy("time", "desc")
      .groupBy("source", "time", "symbol", "price", "volume_24h")
      .limit(10);
  }

  /**
   * Get time-bucketed price data using TimescaleDB time_bucket
   */
  async getTimeBucketed(
    symbol: string,
    bucketInterval: string,
    startTime: Date
  ): Promise<{ bucket: Date; avg_price: number; source: string }[]> {
    return this.db.raw(
      `SELECT time_bucket(?, time) AS bucket, source, AVG(price) AS avg_price
       FROM prices
       WHERE symbol = ? AND time >= ?
       GROUP BY bucket, source
       ORDER BY bucket DESC`,
      [bucketInterval, symbol, startTime]
    );
  }
}
