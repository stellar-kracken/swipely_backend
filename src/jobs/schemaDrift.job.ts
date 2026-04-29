import { logger } from "../utils/logger.js";
import { schemaDriftService } from "../services/schemaDrift.service.ts";
import { getDatabase } from "../database/connection.js";

/**
 * Scheduled job to analyze and report schema drifts.
 * Runs daily to summarize drift incidents and notify admins.
 */
export async function schemaDriftJob(): Promise<void> {
  const jobStartTime = Date.now();
  logger.info("Starting schema drift analysis job");

  try {
    const report = await schemaDriftService.getDriftReport();
    
    const driftSources = report.summary.filter((s: any) => parseInt(s.incident_count) > 0);
    
    if (driftSources.length > 0) {
      logger.warn(
        { driftSourceCount: driftSources.length },
        "Schema drift detected in multiple upstream sources during scheduled check"
      );
      
      // Here we could trigger a summary email or discord notification
      // for all detected drifts in the last 24h
    } else {
      logger.info("No new schema drifts detected in scheduled check");
    }

    // Cleanup old resolved incidents (retention policy)
    const db = getDatabase();
    const deletedCount = await db("schema_drift_incidents")
      .where("is_resolved", true)
      .where("detected_at", "<", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) // 30 days
      .delete();
      
    if (deletedCount > 0) {
      logger.info({ deletedCount }, "Cleaned up old resolved schema drift incidents");
    }

  } catch (err) {
    logger.error({ err }, "Schema drift job failed");
  } finally {
    const duration = Date.now() - jobStartTime;
    logger.info({ duration }, "Schema drift analysis job completed");
  }
}
