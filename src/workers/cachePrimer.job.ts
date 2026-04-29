import { Job } from "bullmq";
import { cachePrimerService, CachePriority } from "../services/cachePrimer.service.js";
import { logger } from "../utils/logger.js";

/**
 * Worker processor for cache priming jobs.
 */
export async function processCachePriming(job: Job): Promise<any> {
  const { priority } = job.data as { priority?: CachePriority };
  
  logger.info({ jobId: job.id, priority }, "Processing cache priming job");
  
  try {
    await cachePrimerService.prime(priority);
    return { success: true, priority };
  } catch (error) {
    logger.error({ jobId: job.id, error }, "Cache priming job failed");
    throw error;
  }
}
