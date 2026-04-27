import { auditService } from "../services/audit.service.js";
import { logger } from "../utils/logger.js";

const DEFAULT_RETENTION_DAYS = 90;

export async function runAuditRetentionJob(retentionDays = DEFAULT_RETENTION_DAYS): Promise<void> {
  logger.info({ retentionDays }, "Running audit log retention job");
  try {
    const deleted = await auditService.applyRetentionPolicy(retentionDays);
    logger.info({ deleted, retentionDays }, "Audit log retention job complete");
  } catch (error) {
    logger.error({ error }, "Audit log retention job failed");
    throw error;
  }
}
