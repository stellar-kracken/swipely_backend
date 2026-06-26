import { Worker, Queue } from "bullmq";
import { config } from "../config/index.js";
import { PriceService, type AggregatedPrice } from "../services/price.service.js";
import { logger } from "../utils/logger.js";
import { alertRoutingService, type RouteableAlert } from "../services/alertRouting.service.js";
import { duplicateAlertCheckService } from "../services/duplicateAlertCheck.service.js";
import type { AlertEvent } from "../services/alert.service.js";
import { PriceModel } from "../database/models/price.model.js";

const QUEUE_NAME = "price-aggregator";

const priceModel = new PriceModel();

const connection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
};

export const priceAggregatorQueue = new Queue(QUEUE_NAME, { connection });

async function persistAggregatedPrice(aggregated: AggregatedPrice): Promise<void> {
  try {
    const now = new Date();
    const records = aggregated.sources.map((src) => ({
      time: now,
      symbol: aggregated.symbol,
      source: src.source,
      price: src.price,
      volume_24h: null as number | null,
    }));
    await priceModel.insertBatch(records);
  } catch (err) {
    logger.error({ err, symbol: aggregated.symbol }, "Failed to persist aggregated price");
  }
}

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
