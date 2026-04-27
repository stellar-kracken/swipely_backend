import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { NewBridgeVolumeStat } from "../database/types.js";

/**
 * Metrics Rollup Service
 * Responsible for aggregating fine-grained data into coarser time buckets for reporting and analytics.
 */
export class MetricsRollupService {
  /**
   * Roll up bridge transactions into daily volume statistics
   * @param date The date to roll up (defaults to yesterday)
   */
  async rollupBridgeVolume(date?: Date): Promise<number> {
    const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000);
    targetDate.setUTCHours(0, 0, 0, 0);
    
    const nextDate = new Date(targetDate);
    nextDate.setUTCDate(targetDate.getUTCDate() + 1);

    logger.info({ targetDate: targetDate.toISOString() }, "Starting bridge volume rollup");

    const db = getDatabase();

    try {
      // Aggregate transactions for the target date
      // We group by bridge_name and symbol
      const aggregations = await db("bridge_transactions")
        .select(
          "bridge_name",
          "symbol",
          db.raw("SUM(CASE WHEN transaction_type = 'mint' THEN amount ELSE 0 END) as inflow"),
          db.raw("SUM(CASE WHEN transaction_type = 'burn' THEN amount ELSE 0 END) as outflow"),
          db.raw("COUNT(*) as tx_count"),
          db.raw("AVG(amount) as avg_size")
        )
        .where("confirmed_at", ">=", targetDate)
        .andWhere("confirmed_at", "<", nextDate)
        .andWhere("status", "confirmed")
        .groupBy("bridge_name", "symbol");

      let updatedCount = 0;

      for (const agg of aggregations) {
        const inflow = parseFloat(agg.inflow || "0");
        const outflow = parseFloat(agg.outflow || "0");
        const netFlow = inflow - outflow;

        const stat: NewBridgeVolumeStat = {
          stat_date: targetDate,
          bridge_name: agg.bridge_name,
          symbol: agg.symbol,
          inflow_amount: inflow.toString(),
          outflow_amount: outflow.toString(),
          net_flow: netFlow.toString(),
          tx_count: parseInt(agg.tx_count, 10),
          avg_tx_size: agg.avg_size ? agg.avg_size.toString() : "0",
        };

        // Upsert the stat
        await db("bridge_volume_stats")
          .insert(stat)
          .onConflict(["stat_date", "bridge_name", "symbol"])
          .merge();
        
        updatedCount++;
      }

      logger.info({ targetDate: targetDate.toISOString(), updatedCount }, "Completed bridge volume rollup");
      return updatedCount;
    } catch (error) {
      logger.error({ error, targetDate: targetDate.toISOString() }, "Failed to perform bridge volume rollup");
      throw error;
    }
  }

  /**
   * Roll up data for a range of dates
   */
  async rollupRange(startDate: Date, endDate: Date): Promise<void> {
    const current = new Date(startDate);
    current.setUTCHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setUTCHours(0, 0, 0, 0);

    while (current <= end) {
      await this.rollupBridgeVolume(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }
}
