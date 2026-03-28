import { Job } from "bullmq";
import { HealthService } from "../services/health.service.js";
import { SUPPORTED_ASSETS } from "../config/index.js";
import { logger } from "../utils/logger.js";

const healthService = new HealthService();

export async function processHealthCalculation(job: Job) {
  logger.info({ jobId: job.id }, "Starting health score calculation job");
  
  try {
    const results = await healthService.computeAllHealthScores();
    logger.info({ count: results.length }, "Completed health score calculations for all assets");
  } catch (error) {
    logger.error({ error }, "Failed to compute all health scores in background job");
    throw error;
  }
}
