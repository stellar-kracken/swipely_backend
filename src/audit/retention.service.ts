import { getDatabase } from "../database/connection.js";
import { RetentionPolicies } from "./audit.constants.js";
import { logger } from "../utils/logger.js";

export class RetentionService {
  async runCleanupWorker(): Promise<void> {
    const db = getDatabase();
    
    // Applying standard retention policy
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RetentionPolicies.analytics);

    const deleted = await db("audit_logs")
      .where("created_at", "<", cutoffDate)
      .delete();
      
    logger.info(`Retention cleanup deleted ${deleted} old audit logs.`);
  }
}

export const retentionService = new RetentionService();
