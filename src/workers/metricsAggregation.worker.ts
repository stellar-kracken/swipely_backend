import { Job } from "bullmq";
import { metricsAggregationService, type MetricGranularity } from "../services/metricsAggregation.service.js";
import { logger } from "../utils/logger.js";

/**
 * Worker that rolls up raw metric data points into multi-level summaries
 * (hourly -> daily -> weekly) and prunes data per the retention policy.
 */
export async function processMetricsAggregation(job: Job) {
  const { type } = job.data as { type: "hourly" | "daily" | "weekly" | "retention" };

  logger.info({ jobId: job.id, type }, "Starting metrics aggregation job");

  try {
    if (type === "retention") {
      const deleted = await metricsAggregationService.applyRetentionPolicies();
      logger.info({ deleted }, "Completed metrics retention cleanup");
      return { success: true, deleted };
    }

    const granularity = type as MetricGranularity;
    const windows = await metricsAggregationService.runRollup(granularity);
    logger.info({ granularity, windows }, "Completed metrics rollup");
    return { success: true, windows };
  } catch (error) {
    logger.error({ error, jobId: job.id }, "Metrics aggregation job failed");
    throw error;
  }
}
