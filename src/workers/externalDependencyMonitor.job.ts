import type { Job } from "bullmq";
import { logger } from "../utils/logger.js";
import { ExternalDependencyMonitorService } from "../services/externalDependencyMonitor.service.js";

export async function processExternalDependencyMonitor(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, "Starting external dependency monitor job");

  const monitorService = new ExternalDependencyMonitorService();
  await monitorService.runAllChecks("scheduled");
}
