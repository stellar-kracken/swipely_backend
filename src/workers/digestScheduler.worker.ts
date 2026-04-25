import { Job } from "bullmq";
import { DigestSchedulerService, DigestType } from "../services/digestScheduler.service.js";
import { logger } from "../utils/logger.js";

export interface DigestSchedulerJobData {
  digestType: DigestType;
}

/**
 * Process digest scheduler jobs
 * Generates and sends scheduled digest notifications
 */
export async function processDigestScheduler(job: Job<DigestSchedulerJobData>): Promise<void> {
  const { digestType } = job.data;

  logger.info({ jobId: job.id, digestType }, "Processing digest scheduler job");

  const digestService = DigestSchedulerService.getInstance();

  try {
    // Generate digests for eligible subscriptions
    const generatedCount = await digestService.generateDigests(digestType);

    // Process pending deliveries
    const deliveredCount = await digestService.processPendingDeliveries();

    logger.info(
      { jobId: job.id, digestType, generatedCount, deliveredCount },
      "Digest scheduler job completed"
    );
  } catch (error) {
    logger.error(
      { error, jobId: job.id, digestType },
      "Digest scheduler job failed"
    );
    throw error;
  }
}
