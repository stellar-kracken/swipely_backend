import { Job } from "bullmq";
import { stalenessDetectionService } from "../services/stalenessDetection.service.js";
import { logger } from "../utils/logger.js";

export async function processStalenessDetection(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, "Starting staleness detection job");

  try {
    const result = await stalenessDetectionService.runScheduledCheck();
    logger.info(
      { jobId: job.id, status: result.snapshot.status, alerts: result.alerts.length },
      "Staleness detection job completed"
    );
  } catch (error) {
    logger.error({ jobId: job.id, error }, "Staleness detection job failed");
    throw error;
  }
}
