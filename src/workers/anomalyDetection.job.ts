import { Job } from "bullmq";
import { anomalyDetectionService } from "../services/anomalyDetection.service.js";
import { logger } from "../utils/logger.js";

export async function processAnomalyDetection(job: Job) {
  logger.info({ jobId: job.id }, "Starting anomaly detection job");

  const results = await anomalyDetectionService.evaluateAllAssets();
  const emitted = results.filter((result) => result.anomaly).length;
  const suppressed = results.filter((result) => result.suppressed).length;

  logger.info({ evaluated: results.length, emitted, suppressed }, "Completed anomaly detection job");
}
