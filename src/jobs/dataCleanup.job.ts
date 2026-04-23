import { Worker, Job } from "bullmq";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

export interface RetentionPolicy {
  entityType: string;
  tableName: string;
  retentionDays: number;
  archiveBeforeDelete: boolean;
  criticalDataPoints: string[];
  preserveCondition?: string;
}

export interface CleanupReport {
  entityType: string;
  tableName: string;
  retentionDays: number;
  recordsProcessed: number;
  recordsArchived: number;
  recordsDeleted: number;
  errors: string[];
  duration: number;
  timestamp: Date;
}

export interface CleanupMetrics {
  totalRecordsProcessed: number;
  totalRecordsArchived: number;
  totalRecordsDeleted: number;
  storageSaved: number;
  duration: number;
  reports: CleanupReport[];
}

export class DataCleanupJob {
  private db = getDatabase();
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      "data-cleanup",
      this.processCleanupJob.bind(this),
      {
        connection: {
          host: config.REDIS_HOST,
          port: config.REDIS_PORT,
        },
        concurrency: 1,
        limiter: {
          max: 1,
          duration: 60000, // 1 minute between jobs
        },
      }
    );

    this.worker.on("completed", (job: Job) => {
      logger.info({ jobId: job.id }, "Data cleanup job completed");
    });

    this.worker.on("failed", (job: Job | undefined, err: Error) => {
      logger.error({ jobId: job?.id, error: err }, "Data cleanup job failed");
    });
  }

  /**
   * Start the data cleanup job scheduler
   */
  static async startScheduler(): Promise<void> {
    const { Queue } = await import("bullmq");
    const queue = new Queue("data-cleanup", {
      connection: {
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
      },
    });

    // Schedule cleanup job to run daily at 2 AM UTC
    await queue.add(
      "daily-cleanup",
      {},
      {
        repeat: {
          pattern: "0 2 * * *", // Cron expression for daily at 2 AM
        },
        removeOnComplete: 10,
        removeOnFail: 5,
      }
    );

    logger.info("Data cleanup scheduler started");
  }

  /**
   * Process a cleanup job
   */
  private async processCleanupJob(job: Job): Promise<CleanupMetrics> {
    const startTime = Date.now();
    const dryRun = job.data.dryRun || false;
    const force = job.data.force || false;

    logger.info({ dryRun, force }, "Starting data cleanup job");

    const reports: CleanupReport[] = [];
    const retentionPolicies = this.getRetentionPolicies();

    for (const policy of retentionPolicies) {
      try {
        const report = await this.cleanupEntityType(policy, dryRun, force);
        reports.push(report);
      } catch (error) {
        logger.error({ policy: policy.entityType, error }, "Failed to cleanup entity type");
        reports.push({
          entityType: policy.entityType,
          tableName: policy.tableName,
          retentionDays: policy.retentionDays,
          recordsProcessed: 0,
          recordsArchived: 0,
          recordsDeleted: 0,
          errors: [error instanceof Error ? error.message : String(error)],
          duration: 0,
          timestamp: new Date(),
        });
      }
    }

    const totalMetrics = this.calculateTotalMetrics(reports, startTime);

    // Log cleanup summary
    logger.info(totalMetrics, "Data cleanup job completed");

    // Store cleanup metrics
    await this.storeCleanupMetrics(totalMetrics);

    return totalMetrics;
  }

  /**
   * Get retention policies for different entity types
   */
  private getRetentionPolicies(): RetentionPolicy[] {
    return [
      {
        entityType: "prices",
        tableName: "prices",
        retentionDays: 90,
        archiveBeforeDelete: true,
        criticalDataPoints: ["time", "symbol", "source"],
        preserveCondition: "time > NOW() - INTERVAL '7 days'", // Keep last 7 days regardless
      },
      {
        entityType: "health_scores",
        tableName: "health_scores",
        retentionDays: 180,
        archiveBeforeDelete: true,
        criticalDataPoints: ["time", "symbol", "overall_score"],
        preserveCondition: "time > NOW() - INTERVAL '30 days'", // Keep last 30 days regardless
      },
      {
        entityType: "pool_events",
        tableName: "pool_events",
        retentionDays: 60,
        archiveBeforeDelete: true,
        criticalDataPoints: ["time", "pool_id", "type"],
        preserveCondition: "type IN ('deposit', 'withdraw') AND time > NOW() - INTERVAL '14 days'",
      },
      {
        entityType: "pool_metrics",
        tableName: "pool_metrics",
        retentionDays: 120,
        archiveBeforeDelete: true,
        criticalDataPoints: ["time", "pool_id", "tvl"],
        preserveCondition: "time > NOW() - INTERVAL '30 days'",
      },
      {
        entityType: "search_analytics",
        tableName: "search_analytics",
        retentionDays: 90,
        archiveBeforeDelete: false,
        criticalDataPoints: ["time", "query"],
        preserveCondition: undefined,
      },
      {
        entityType: "verification_results",
        tableName: "verification_results",
        retentionDays: 365,
        archiveBeforeDelete: true,
        criticalDataPoints: ["timestamp", "bridge_name", "status"],
        preserveCondition: "status = 'failed' AND time > NOW() - INTERVAL '90 days'",
      },
    ];
  }

  /**
   * Cleanup a specific entity type
   */
  private async cleanupEntityType(
    policy: RetentionPolicy,
    dryRun: boolean,
    force: boolean
  ): Promise<CleanupReport> {
    const startTime = Date.now();
    logger.info({ policy: policy.entityType, dryRun }, "Starting cleanup for entity type");

    const report: CleanupReport = {
      entityType: policy.entityType,
      tableName: policy.tableName,
      retentionDays: policy.retentionDays,
      recordsProcessed: 0,
      recordsArchived: 0,
      recordsDeleted: 0,
      errors: [],
      duration: 0,
      timestamp: new Date(),
    };

    try {
      // Get count of records to be processed
      const cutoffDate = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
      
      let whereCondition = `time < '${cutoffDate.toISOString()}'`;
      if (policy.preserveCondition) {
        whereCondition += ` AND NOT (${policy.preserveCondition})`;
      }

      // Count records to be processed
      const countResult = await this.db(policy.tableName)
        .whereRaw(whereCondition)
        .count("* as count")
        .first();

      const recordsToProcess = Number(countResult?.count) || 0;
      report.recordsProcessed = recordsToProcess;

      if (recordsToProcess === 0) {
        logger.info({ policy: policy.entityType }, "No records to cleanup");
        report.duration = Date.now() - startTime;
        return report;
      }

      // Archive data if required
      if (policy.archiveBeforeDelete && !dryRun) {
        const archivedCount = await this.archiveData(policy, whereCondition);
        report.recordsArchived = archivedCount;
      }

      // Delete old data
      if (!dryRun || force) {
        const deletedCount = await this.deleteOldData(policy, whereCondition, dryRun);
        report.recordsDeleted = deletedCount;
      }

      logger.info({
        policy: policy.entityType,
        recordsProcessed: report.recordsProcessed,
        recordsArchived: report.recordsArchived,
        recordsDeleted: report.recordsDeleted,
        dryRun,
      }, "Cleanup completed for entity type");

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      report.errors.push(errorMessage);
      logger.error({ policy: policy.entityType, error: errorMessage }, "Cleanup failed for entity type");
    }

    report.duration = Date.now() - startTime;
    return report;
  }

  /**
   * Archive data before deletion
   */
  private async archiveData(policy: RetentionPolicy, whereCondition: string): Promise<number> {
    const archiveTable = `${policy.tableName}_archive`;
    
    // Ensure archive table exists
    await this.ensureArchiveTable(policy.tableName, archiveTable);

    // Get data to archive
    const dataToArchive = await this.db(policy.tableName)
      .whereRaw(whereCondition)
      .select("*");

    if (dataToArchive.length === 0) {
      return 0;
    }

    // Insert into archive table in batches
    const batchSize = 1000;
    let archivedCount = 0;

    for (let i = 0; i < dataToArchive.length; i += batchSize) {
      const batch = dataToArchive.slice(i, i + batchSize);
      await this.db(archiveTable).insert(batch);
      archivedCount += batch.length;
    }

    logger.info({
      policy: policy.entityType,
      archivedCount,
      archiveTable,
    }, "Data archived successfully");

    return archivedCount;
  }

  /**
   * Delete old data
   */
  private async deleteOldData(
    policy: RetentionPolicy,
    whereCondition: string,
    dryRun: boolean
  ): Promise<number> {
    if (dryRun) {
      // Just return the count without deleting
      const countResult = await this.db(policy.tableName)
        .whereRaw(whereCondition)
        .count("* as count")
        .first();
      return Number(countResult?.count) || 0;
    }

    // Delete in batches to avoid long-running transactions
    const batchSize = 1000;
    let totalDeleted = 0;
    let hasMore = true;

    while (hasMore) {
      const deletedCount = await this.db(policy.tableName)
        .whereRaw(whereCondition)
        .limit(batchSize)
        .del();

      totalDeleted += deletedCount;
      hasMore = deletedCount === batchSize;

      // Add small delay between batches to reduce database load
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    logger.info({
      policy: policy.entityType,
      totalDeleted,
    }, "Data deleted successfully");

    return totalDeleted;
  }

  /**
   * Ensure archive table exists with proper structure
   */
  private async ensureArchiveTable(tableName: string, archiveTableName: string): Promise<void> {
    const tableExists = await this.db.schema.hasTable(archiveTableName);
    
    if (!tableExists) {
      // Get the structure of the original table
      const tableInfo = await this.db.raw(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = '${tableName}'
        ORDER BY ordinal_position
      `);

      // Create archive table with similar structure
      await this.db.schema.createTable(archiveTableName, (table) => {
        table.increments("id").primary();
        
        tableInfo.rows.forEach((column: any) => {
          const columnName = column.column_name;
          const dataType = column.data_type;
          const nullable = column.is_nullable === "YES";
          
          if (columnName === "id") return; // Skip the original id, we have our own
          
          let field: any;
          
          if (dataType.includes("timestamp")) {
            field = table.timestamp(columnName);
          } else if (dataType.includes("decimal")) {
            field = table.decimal(columnName, 20, 8);
          } else if (dataType.includes("integer")) {
            field = table.integer(columnName);
          } else if (dataType.includes("uuid")) {
            field = table.uuid(columnName);
          } else if (dataType.includes("json")) {
            field = table.json(columnName);
          } else {
            field = table.string(columnName);
          }
          
          if (!nullable) field.notNullable();
          if (column.column_default) field.defaultTo(column.column_default);
        });
        
        table.timestamps(true, true);
      });

      // Create indexes for better query performance
      await this.db.raw(`
        CREATE INDEX IF NOT EXISTS idx_${archiveTableName}_time 
        ON ${archiveTableName} (time)
      `);

      logger.info({ archiveTableName }, "Archive table created");
    }
  }

  /**
   * Calculate total metrics from all reports
   */
  private calculateTotalMetrics(reports: CleanupReport[], startTime: number): CleanupMetrics {
    const totalRecordsProcessed = reports.reduce((sum, report) => sum + report.recordsProcessed, 0);
    const totalRecordsArchived = reports.reduce((sum, report) => sum + report.recordsArchived, 0);
    const totalRecordsDeleted = reports.reduce((sum, report) => sum + report.recordsDeleted, 0);
    const duration = Date.now() - startTime;

    // Estimate storage saved (rough calculation)
    const storageSaved = totalRecordsDeleted * 1024; // Assume 1KB per record

    return {
      totalRecordsProcessed,
      totalRecordsArchived,
      totalRecordsDeleted,
      storageSaved,
      duration,
      reports,
    };
  }

  /**
   * Store cleanup metrics for monitoring
   */
  private async storeCleanupMetrics(metrics: CleanupMetrics): Promise<void> {
    try {
      await this.db("cleanup_metrics").insert({
        total_records_processed: metrics.totalRecordsProcessed,
        total_records_archived: metrics.totalRecordsArchived,
        total_records_deleted: metrics.totalRecordsDeleted,
        storage_saved: metrics.storageSaved,
        duration: metrics.duration,
        reports: JSON.stringify(metrics.reports),
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error({ error }, "Failed to store cleanup metrics");
    }
  }

  /**
   * Get storage metrics
   */
  async getStorageMetrics(): Promise<any> {
    try {
      const metrics = await this.db.raw(`
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
          pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      `);

      return metrics.rows;
    } catch (error) {
      logger.error({ error }, "Failed to get storage metrics");
      return [];
    }
  }

  /**
   * Run cleanup manually
   */
  async runCleanup(dryRun = false, force = false): Promise<CleanupMetrics> {
    const { Queue } = await import("bullmq");
    const queue = new Queue("data-cleanup", {
      connection: {
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
      },
    });

    const job = await queue.add("manual-cleanup", { dryRun, force });
    
    // Wait for job completion
    const result = await job.waitUntilFinished(queue);
    
    return result as CleanupMetrics;
  }
}
