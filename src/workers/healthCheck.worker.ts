import { Worker, Queue } from "bullmq";
import { config } from "../config/index.js";
import { HealthService } from "../services/health.service.js";
import { logger } from "../utils/logger.js";

const QUEUE_NAME = "health-check";

const connection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
};

export const healthCheckQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Worker that periodically computes composite health scores for all
 * monitored assets and persists them for trending analysis.
 */
export const healthCheckWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const healthService = new HealthService();
    logger.info({ jobId: job.id }, "Processing health check job");

    try {
      const scores = await healthService.computeAllHealthScores();

      // TODO: Persist health scores to TimescaleDB
      // TODO: Detect deteriorating trends and trigger alerts

      logger.info(
        { assetCount: scores.length },
        "Health check completed for all assets"
      );

      return { success: true, scores };
    } catch (error) {
      logger.error({ error }, "Health check job failed");
      throw error;
    }
  },
  { connection, concurrency: 1 }
);

healthCheckWorker.on("completed", (job) => {
  logger.debug({ jobId: job?.id }, "Health check job completed");
});

healthCheckWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "Health check job failed");
});
