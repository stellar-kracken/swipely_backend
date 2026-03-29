import { Job } from "bullmq";
import { BackupMonitoringService } from "../services/backupMonitoring.service.js";
import { logger } from "../utils/logger.js";

export interface BackupMonitoringJobData {
  type: "health_check" | "metrics_collection" | "status_report";
}

const monitoringService = new BackupMonitoringService();

export async function processBackupMonitoringJob(job: Job<BackupMonitoringJobData>): Promise<void> {
  const { type } = job.data;

  logger.info({ jobId: job.id, type }, "Processing backup monitoring job");

  try {
    switch (type) {
      case "health_check":
        await monitoringService.runHealthCheck();
        break;

      case "metrics_collection":
        await monitoringService.logMetrics();
        break;

      case "status_report": {
        const report = await monitoringService.generateStatusReport();
        logger.info({ report }, "Backup status report generated");
        console.log(report);
        break;
      }

      default:
        throw new Error(`Unknown monitoring job type: ${type}`);
    }

    logger.info({ jobId: job.id, type }, "Backup monitoring job completed");
  } catch (error) {
    logger.error({ jobId: job.id, type, error }, "Backup monitoring job failed");
    throw error;
  }
}
