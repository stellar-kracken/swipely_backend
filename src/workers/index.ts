import { Job } from "bullmq";
import { JobQueue } from "./queue.js";
import { processPriceCollection } from "./priceCollection.job.js";
import { processHealthCalculation } from "./healthCalculation.job.js";
import { processBridgeVerification } from "./bridgeVerification.job.js";
import { logger } from "../utils/logger.js";

export async function initJobSystem() {
  const jobQueue = JobQueue.getInstance();

  // Initialize worker with processor
  jobQueue.initWorker(async (job: Job) => {
    switch (job.name) {
      case "price-collection":
        await processPriceCollection(job);
        break;
      case "health-calculation":
        await processHealthCalculation(job);
        break;
      case "bridge-verification":
        await processBridgeVerification(job);
        break;
      default:
        logger.warn({ jobName: job.name }, "Unknown job name in worker");
    }
  });

  // Schedule repeatable jobs
  // price-collection: every 30 seconds
  await jobQueue.addRepeatableJob("price-collection", {}, "*/30 * * * * *");
  
  // health-calculation: every 5 minutes
  await jobQueue.addRepeatableJob("health-calculation", {}, "*/5 * * * *");
  
  // bridge-verification: every 5 minutes
  await jobQueue.addRepeatableJob("bridge-verification", {}, "*/5 * * * *");

  logger.info("Scheduled job system initialized");
}
