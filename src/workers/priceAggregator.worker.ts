import { Worker, Queue } from "bullmq";
import { config } from "../config/index.js";
import { PriceService } from "../services/price.service.js";
import { logger } from "../utils/logger.js";

const QUEUE_NAME = "price-aggregator";

const connection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
};

export const priceAggregatorQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Worker that periodically aggregates prices from multiple sources:
 * - Stellar DEX (SDEX + AMM pools)
 * - Circle API
 * - Coinbase API
 *
 * Computes VWAP and checks for price deviations exceeding thresholds.
 */
export const priceAggregatorWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const priceService = new PriceService();
    logger.info({ jobId: job.id, data: job.data }, "Processing price aggregation job");

    const { symbol } = job.data;

    try {
      const aggregatedPrice = await priceService.getAggregatedPrice(symbol);

      // Check for deviation
      const deviation = await priceService.checkDeviation(symbol);
      if (deviation.deviated) {
        logger.warn(
          { symbol, deviation: deviation.percentage },
          "Price deviation detected"
        );
        // TODO: Trigger price deviation alert
      }

      // TODO: Persist aggregated price to TimescaleDB
      return { success: true, symbol, price: aggregatedPrice };
    } catch (error) {
      logger.error({ error, symbol }, "Price aggregation job failed");
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

priceAggregatorWorker.on("completed", (job) => {
  logger.debug({ jobId: job?.id }, "Price aggregation job completed");
});

priceAggregatorWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "Price aggregation job failed");
});
