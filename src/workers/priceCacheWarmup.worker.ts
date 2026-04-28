import { Job } from "bullmq";
import { runPriceCacheWarmup } from "../jobs/priceCacheWarmup.job.js";
import { logger } from "../utils/logger.js";

/**
 * Process price cache warmup job
 */
export async function processPriceCacheWarmup(job: Job): Promise<void> {
  try {
    logger.info({ jobId: job.id }, "Processing price cache warmup job");
    
    const metrics = await runPriceCacheWarmup();
    
    logger.info(
      {
        jobId: job.id,
        metrics,
      },
      "Price cache warmup job completed successfully"
    );
  } catch (error) {
    logger.error(
      {
        jobId: job.id,
        error,
      },
      "Price cache warmup job failed"
    );
    throw error;
  }
}
