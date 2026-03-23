import { Worker, Queue } from "bullmq";
import { config } from "../config/index.js";
import { BridgeService } from "../services/bridge.service.js";
import { logger } from "../utils/logger.js";

const QUEUE_NAME = "bridge-monitor";

const connection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
};

export const bridgeMonitorQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Worker that continuously monitors bridge integrity:
 * - Tracks mint/burn events on Stellar
 * - Verifies supply consistency across chains
 * - Detects supply mismatches above the configured threshold
 * - Records bridge performance and uptime
 */
export const bridgeMonitorWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const bridgeService = new BridgeService();
    logger.info({ jobId: job.id, data: job.data }, "Processing bridge monitor job");

    const { assetCode } = job.data;

    try {
      // Verify supply consistency
      const supplyCheck = await bridgeService.verifySupply(assetCode);

      if (!supplyCheck.match) {
        logger.warn(
          { ...supplyCheck },
          "Bridge supply mismatch detected"
        );
        // TODO: Trigger alert via configured notification channel
      }

      // TODO: Record results in TimescaleDB for historical tracking
      return { success: true, assetCode, supplyCheck };
    } catch (error) {
      logger.error({ error, assetCode }, "Bridge monitor job failed");
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

bridgeMonitorWorker.on("completed", (job) => {
  logger.debug({ jobId: job?.id }, "Bridge monitor job completed");
});

bridgeMonitorWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "Bridge monitor job failed");
});
