import crypto from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

/**
 * Types of ingestion jobs.
 */
export type IngestionJobType = "alert" | "event" | "metric";

/**
 * Priority levels for the queue.
 */
export enum JobPriority {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4,
}

/**
 * Payload shape for a job – free form JSON.
 */
export interface IngestionJobPayload {
  [key: string]: unknown;
}

/**
 * Represents a job stored in the database.
 */
export interface IngestionJob {
  id: string;
  type: IngestionJobType;
  priority: JobPriority;
  payload: IngestionJobPayload;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  nextRetryAt: Date | null;
  status: "pending" | "processing" | "failed" | "completed";
}

/**
 * Simple metrics exposed by the manager.
 */
export interface IngestionMetrics {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
}

/**
 * Ingestion Queue Manager – singleton service that handles job lifecycle.
 *
 * Features:
 *  - Priority queue (higher numeric value = higher priority).
 *  - Configurable max attempts and exponential back‑off.
 *  - Back‑pressure via a concurrency limit.
 *  - Dead‑letter table for jobs that exceed max attempts.
 *  - Basic metrics for monitoring.
 *  - Manual re‑queue of dead‑letter jobs.
 */
export class IngestionQueueManager {
  private static instance: IngestionQueueManager;

  // Concurrency limit – how many jobs may be processed in parallel.
  private readonly concurrencyLimit: number;
  // Current number of jobs being processed.
  private processingCount = 0;

  private constructor(concurrencyLimit: number = 5) {
    this.concurrencyLimit = concurrencyLimit;
  }

  public static getInstance(): IngestionQueueManager {
    if (!IngestionQueueManager.instance) {
      IngestionQueueManager.instance = new IngestionQueueManager();
    }
    return IngestionQueueManager.instance;
  }

  /**
   * Enqueue a new ingestion job.
   * The job is stored in the `ingestion_jobs` table.
   */
  public async enqueueJob(params: {
    type: IngestionJobType;
    priority?: JobPriority;
    payload: IngestionJobPayload;
    maxAttempts?: number;
  }): Promise<IngestionJob> {
    const db = getDatabase();
    const now = new Date();
    const job: IngestionJob = {
      id: crypto.randomUUID(),
      type: params.type,
      priority: params.priority ?? JobPriority.MEDIUM,
      payload: params.payload,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 3,
      createdAt: now,
      updatedAt: now,
      nextRetryAt: null,
      status: "pending",
    };

    await db("ingestion_jobs").insert({
      id: job.id,
      type: job.type,
      priority: job.priority,
      payload: JSON.stringify(job.payload),
      attempts: job.attempts,
      max_attempts: job.maxAttempts,
      created_at: now,
      updated_at: now,
      next_retry_at: null,
      status: job.status,
    });
    logger.info({ jobId: job.id }, "Ingestion job enqueued");
    return job;
  }

  /**
   * Process pending jobs respecting priority and concurrency limits.
   * The caller should invoke this method periodically (e.g., a setInterval).
   */
  public async processPendingJobs(): Promise<void> {
    if (this.processingCount >= this.concurrencyLimit) {
      // Back‑pressure: do not fetch new jobs until a slot is free.
      return;
    }

    const db = getDatabase();
    // Fetch a batch of pending jobs ordered by priority desc and created_at.
    const pendingJobs = await db("ingestion_jobs")
      .where({ status: "pending" })
      .orWhere(function () {
        this.where({ status: "failed" })
          .where("attempts", "<", db.raw("max_attempts"))
          .where((qb: any) => {
            qb.where("next_retry_at", "<=", new Date()).orWhereNull("next_retry_at");
          });
      })
      .orderBy([{ column: "priority", order: "desc" }, { column: "created_at", order: "asc" }])
      .limit(this.concurrencyLimit - this.processingCount);

    for (const row of pendingJobs) {
      this.processingCount++;
      this.handleJob(row).finally(() => {
        this.processingCount--;
      });
    }
  }

  /** Internal helper to handle a single job record. */
  private async handleJob(row: any): Promise<void> {
    const db = getDatabase();
    const jobId = row.id;
    try {
      // Mark as processing
      await db("ingestion_jobs")
        .where({ id: jobId })
        .update({ status: "processing", updated_at: new Date() });

      // Simulate processing – real implementation would call a handler based on `type`.
      await this.processJobLogic(row);

      // Mark completed
      await db("ingestion_jobs")
        .where({ id: jobId })
        .update({ status: "completed", updated_at: new Date() });
      logger.info({ jobId }, "Ingestion job completed");
    } catch (err) {
      // Increment attempt counter and decide next step
      const attempts = (row.attempts ?? 0) + 1;
      const maxAttempts = row.max_attempts ?? 3;
      const nextRetry = attempts < maxAttempts ? this.calculateBackoff(attempts) : null;
      const newStatus = attempts >= maxAttempts ? "failed" : "failed"; // keep "failed" until moved to dead‑letter.

      await db("ingestion_jobs")
        .where({ id: jobId })
        .update({
          attempts,
          next_retry_at: nextRetry,
          status: newStatus,
          updated_at: new Date(),
        });

      logger.error({ jobId, err }, "Ingestion job processing failed");

      if (attempts >= maxAttempts) {
        // Move to dead‑letter table
        await this.moveToDeadLetter(row);
      }
    }
  }

  /** Placeholder for actual job handling logic – to be replaced with real implementation. */
  private async processJobLogic(jobRow: any): Promise<void> {
    // For demonstration we simply resolve immediately.
    // Real code would deserialize payload and call appropriate handler.
    return;
  }

  /** Calculate exponential back‑off delay based on attempt count. */
  private calculateBackoff(attempt: number): Date {
    const baseDelayMs = 5_000; // 5 seconds
    const delay = baseDelayMs * Math.pow(2, attempt - 1);
    const next = new Date();
    next.setTime(next.getTime() + delay);
    return next;
  }

  /** Move a job record to the dead‑letter table. */
  private async moveToDeadLetter(jobRow: any): Promise<void> {
    const db = getDatabase();
    // Insert into dead_letter_jobs table preserving original fields.
    await db("dead_letter_jobs").insert({
      id: jobRow.id,
      type: jobRow.type,
      priority: jobRow.priority,
      payload: jobRow.payload,
      attempts: jobRow.attempts,
      max_attempts: jobRow.max_attempts,
      error_message: jobRow.last_error ?? null,
      created_at: jobRow.created_at,
      failed_at: new Date(),
    });
    // Remove from ingestion_jobs
    await db("ingestion_jobs").where({ id: jobRow.id }).delete();
    logger.warn({ jobId: jobRow.id }, "Job moved to dead‑letter queue");
  }

  /** Retrieve simple metrics for monitoring. */
  public async getMetrics(): Promise<IngestionMetrics> {
    const db = getDatabase();
    const [{ pending }, { processing }, { completed }, { failed }, { deadLetter }] = await Promise.all([
      db("ingestion_jobs").where({ status: "pending" }).count({ count: "*" }).first(),
      db("ingestion_jobs").where({ status: "processing" }).count({ count: "*" }).first(),
      db("ingestion_jobs").where({ status: "completed" }).count({ count: "*" }).first(),
      db("ingestion_jobs").where({ status: "failed" }).count({ count: "*" }).first(),
      db("dead_letter_jobs").count({ count: "*" }).first(),
    ]);
    return {
      pending: Number(pending?.count ?? 0),
      processing: Number(processing?.count ?? 0),
      completed: Number(completed?.count ?? 0),
      failed: Number(failed?.count ?? 0),
      deadLetter: Number(deadLetter?.count ?? 0),
    };
  }

  /** Manually re‑queue a dead‑letter job back into the ingestion queue. */
  public async requeueDeadLetter(jobId: string): Promise<void> {
    const db = getDatabase();
    const deadJob = await db("dead_letter_jobs").where({ id: jobId }).first();
    if (!deadJob) {
      throw new Error(`Dead‑letter job not found: ${jobId}`);
    }
    // Insert back into ingestion_jobs with attempts reset.
    const now = new Date();
    await db("ingestion_jobs").insert({
      id: deadJob.id,
      type: deadJob.type,
      priority: deadJob.priority,
      payload: deadJob.payload,
      attempts: 0,
      max_attempts: deadJob.max_attempts ?? 3,
      created_at: deadJob.created_at,
      updated_at: now,
      next_retry_at: null,
      status: "pending",
    });
    // Remove from dead_letter_jobs
    await db("dead_letter_jobs").where({ id: jobId }).delete();
    logger.info({ jobId }, "Dead‑letter job re‑queued");
  }
}

export const ingestionQueueManager = IngestionQueueManager.getInstance();
