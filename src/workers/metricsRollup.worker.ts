import { Job } from "bullmq";
import { MetricsRollupService } from "../services/metricsRollup.service.js";
import { logger } from "../utils/logger.js";

const metricsRollupService = new MetricsRollupService();

/**
 * Worker responsible for performing metrics rollups.
 * This aggregates fine-grained data into summary tables for long-term storage and efficient querying.
 */
export async function processMetricsRollup(job: Job) {
  const { type, date, startDate, endDate } = job.data;
  
  logger.info({ jobId: job.id, type, date }, "Starting metrics rollup job");

  try {
    switch (type) {
      case "bridge-volume": {
        const rollupDate = date ? new Date(date) : undefined;
        const count = await metricsRollupService.rollupBridgeVolume(rollupDate);
        logger.info({ count }, "Completed bridge volume rollup");
        return { success: true, count };
      }
      
      case "historical-rollup": {
        if (!startDate || !endDate) {
          throw new Error("Historical rollup requires startDate and endDate");
        }
        await metricsRollupService.rollupRange(new Date(startDate), new Date(endDate));
        logger.info("Completed historical rollup range");
        return { success: true };
      }

      default:
        logger.warn({ type }, "Unknown rollup type");
        return { success: false, error: "Unknown rollup type" };
    }
  } catch (error) {
    logger.error({ error, jobId: job.id }, "Metrics rollup job failed");
    throw error;
  }
}
