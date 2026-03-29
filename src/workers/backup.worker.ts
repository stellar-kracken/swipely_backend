import { Job } from "bullmq";
import { BackupService } from "../services/backup.service.js";
import { logger } from "../utils/logger.js";

export interface BackupJobData {
  type: "full" | "incremental" | "cleanup";
  options?: {
    verifyAfterBackup?: boolean;
    uploadToS3?: boolean;
  };
}

const backupService = new BackupService();

export async function processBackupJob(job: Job<BackupJobData>): Promise<void> {
  const { type, options } = job.data;

  logger.info({ jobId: job.id, type }, "Processing backup job");

  try {
    switch (type) {
      case "full":
        await backupService.createBackup();
        break;

      case "incremental":
        // For incremental, we create a point-in-time backup
        await backupService.createPointInTimeBackup();
        break;

      case "cleanup":
        const deletedCount = await backupService.cleanupOldBackups();
        logger.info({ deletedCount }, "Cleanup job completed");
        break;

      default:
        throw new Error(`Unknown backup job type: ${type}`);
    }

    logger.info({ jobId: job.id, type }, "Backup job completed successfully");
  } catch (error) {
    logger.error({ jobId: job.id, type, error }, "Backup job failed");
    throw error;
  }
}
