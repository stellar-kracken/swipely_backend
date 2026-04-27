import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DataCleanupJob } from "../../jobs/dataCleanup.job.js";
import { getDatabase } from "../../database/connection.js";
import { logger } from "../../utils/logger.js";

const cleanupJob = new DataCleanupJob();

export async function cleanupRoutes(server: FastifyInstance) {
  // Get storage metrics
  server.get(
    "/storage",
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const db = getDatabase();
        const storageMetrics = await cleanupJob.getStorageMetrics();
        
        return { success: true, data: storageMetrics };
      } catch (error) {
        logger.error(error, "Failed to get storage metrics");
        reply.code(500);
        return { success: false, error: "Failed to get storage metrics" };
      }
    }
  );

  // Get retention policies
  server.get("/policies", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDatabase();
      const policies = await db("retention_policies")
        .where("is_active", true)
        .orderBy("retention_days", "asc");

      return { success: true, data: policies };
    } catch (error) {
      logger.error(error, "Failed to get retention policies");
      reply.code(500);
      return { success: false, error: "Failed to get retention policies" };
    }
  });

  // Update retention policy
  server.put(
    "/policies/:entityType",
    async (
      request: FastifyRequest<{
        Params: { entityType: string };
        Body: {
          retentionDays?: number;
          archiveBeforeDelete?: boolean;
          criticalDataPoints?: string[];
          preserveCondition?: string;
          isActive?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { entityType } = request.params;
        const updates = request.body;

        const db = getDatabase();
        const [policy] = await db("retention_policies")
          .where("entity_type", entityType)
          .update({
            ...updates,
            critical_data_points: updates.criticalDataPoints 
              ? JSON.stringify(updates.criticalDataPoints) 
              : undefined,
            updated_at: new Date(),
          })
          .returning("*");

        if (!policy) {
          reply.code(404);
          return { success: false, error: "Retention policy not found" };
        }

        return { success: true, data: policy };
      } catch (error) {
        logger.error(error, "Failed to update retention policy");
        reply.code(500);
        return { success: false, error: "Failed to update retention policy" };
      }
    }
  );

  // Get cleanup history
  server.get(
    "/history",
    async (
      request: FastifyRequest<{
        Querystring: { days?: string; limit?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { days, limit } = request.query;
        const db = getDatabase();

        let query = db("cleanup_metrics")
          .orderBy("time", "desc")
          .limit(limit ? parseInt(limit) : 50);

        if (days) {
          const daysAgo = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
          query = query.where("time", ">", daysAgo);
        }

        const history = await query;

        return { success: true, data: history };
      } catch (error) {
        logger.error(error, "Failed to get cleanup history");
        reply.code(500);
        return { success: false, error: "Failed to get cleanup history" };
      }
    }
  );

  // Get cleanup statistics
  server.get(
    "/statistics",
    async (
      request: FastifyRequest<{
        Querystring: { days?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { days } = request.query;
        const db = getDatabase();

        let whereClause = "";
        if (days) {
          whereClause = `WHERE time >= NOW() - INTERVAL '${days} days'`;
        }

        const statistics = await db.raw(`
          SELECT 
            COUNT(*) as total_cleanups,
            SUM(total_records_processed) as total_records_processed,
            SUM(total_records_archived) as total_records_archived,
            SUM(total_records_deleted) as total_records_deleted,
            SUM(storage_saved) as total_storage_saved,
            AVG(duration) as avg_duration,
            MIN(duration) as min_duration,
            MAX(duration) as max_duration,
            DATE_TRUNC('day', MIN(time)) as first_cleanup,
            DATE_TRUNC('day', MAX(time)) as last_cleanup
          FROM cleanup_metrics 
          ${whereClause}
        `);

        return { success: true, data: statistics.rows[0] };
      } catch (error) {
        logger.error(error, "Failed to get cleanup statistics");
        reply.code(500);
        return { success: false, error: "Failed to get cleanup statistics" };
      }
    }
  );

  // Estimate cleanup impact
  server.get(
    "/estimate/:entityType",
    async (
      request: FastifyRequest<{
        Params: { entityType: string };
        Querystring: { retentionDays?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { entityType } = request.params;
        const { retentionDays } = request.query;

        const db = getDatabase();
        
        // Get the retention policy
        const policy = await db("retention_policies")
          .where("entity_type", entityType)
          .first();

        if (!policy) {
          reply.code(404);
          return { success: false, error: "Retention policy not found" };
        }

        const retentionPeriod = retentionDays 
          ? parseInt(retentionDays) 
          : policy.retention_days;

        // Estimate impact using the function we created
        const estimate = await db.raw(
          `SELECT * FROM estimate_cleanup_impact(?, ?)`,
          [policy.table_name, retentionPeriod]
        );

        return { 
          success: true, 
          data: {
            entityType,
            tableName: policy.table_name,
            retentionDays: retentionPeriod,
            ...estimate.rows[0],
          }
        };
      } catch (error) {
        logger.error(error, "Failed to estimate cleanup impact");
        reply.code(500);
        return { success: false, error: "Failed to estimate cleanup impact" };
      }
    }
  );

  // Run cleanup manually
  server.post(
    "/run",
    async (
      request: FastifyRequest<{
        Body: {
          dryRun?: boolean;
          force?: boolean;
          entityTypes?: string[];
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { dryRun = false, force = false, entityTypes } = request.body;

        // In a real implementation, you might want to validate permissions here
        logger.info({ dryRun, force, entityTypes }, "Manual cleanup triggered");

        const metrics = await cleanupJob.runCleanup(dryRun, force);

        // Filter by entity types if specified
        let filteredReports = metrics.reports;
        if (entityTypes && entityTypes.length > 0) {
          filteredReports = metrics.reports.filter(report => 
            entityTypes.includes(report.entityType)
          );
        }

        return { 
          success: true, 
          data: {
            ...metrics,
            reports: filteredReports,
            dryRun,
          }
        };
      } catch (error) {
        logger.error(error, "Manual cleanup failed");
        reply.code(500);
        return { success: false, error: "Manual cleanup failed" };
      }
    }
  );

  // Get archive metadata
  server.get("/archive", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDatabase();
      const archiveMetadata = await db("archive_metadata")
        .orderBy("last_archived", "desc");

      return { success: true, data: archiveMetadata };
    } catch (error) {
      logger.error(error, "Failed to get archive metadata");
      reply.code(500);
      return { success: false, error: "Failed to get archive metadata" };
    }
  });

  // Cleanup old archive data
  server.post(
    "/archive/cleanup",
    async (
      request: FastifyRequest<{
        Body: { retentionDays?: number };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { retentionDays = 365 } = request.body;
        
        const db = getDatabase();
        const deletedCount = await db.raw(
          "SELECT cleanup_archive_data(?) as deleted_count",
          [retentionDays]
        );

        logger.info({ retentionDays, deletedCount: deletedCount.rows[0].deleted_count }, 
                    "Archive cleanup completed");

        return { 
          success: true, 
          data: {
            deletedCount: deletedCount.rows[0].deleted_count,
            retentionDays,
          }
        };
      } catch (error) {
        logger.error(error, "Archive cleanup failed");
        reply.code(500);
        return { success: false, error: "Archive cleanup failed" };
      }
    }
  );

  // Health check for cleanup system
  server.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDatabase();
      
      // Check if retention policies exist
      const policyCount = await db("retention_policies")
        .where("is_active", true)
        .count("* as count")
        .first();

      // Check last cleanup
      const lastCleanup = await db("cleanup_metrics")
        .orderBy("time", "desc")
        .first();

      // Get storage metrics
      const storageMetrics = await cleanupJob.getStorageMetrics();

      return {
        success: true,
        data: {
          status: "healthy",
          activePolicies: Number(policyCount?.count) || 0,
          lastCleanup: lastCleanup?.time || null,
          totalTables: storageMetrics.length,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error(error, "Cleanup health check failed");
      reply.code(500);
      return { success: false, error: "Cleanup health check failed" };
    }
  });
}
