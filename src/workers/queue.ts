import { Queue, Worker, Job, ConnectionOptions } from "bullmq";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { retryPolicyService } from "../services/retryPolicy.service.js";
import { getMetricsService } from "../services/metrics.service.js";

const connection: ConnectionOptions = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
};

export const QUEUE_NAME = "bridge-watch-jobs";
export type Priority = "critical" | "high" | "medium" | "low";

/**
 * Interval (ms) at which each queue's waiting/active counts are pushed to
 * Prometheus gauges.  Kept short enough to catch bursts without hammering Redis.
 */
const GAUGE_POLL_INTERVAL_MS = 15_000;

export class JobQueue {
  private static instance: JobQueue;
  private queues: Record<string, Queue> = {};
  private workers: Worker[] = [];
  private gaugePollers: NodeJS.Timeout[] = [];

  private constructor() {
    const retryPolicy = retryPolicyService.getPolicy({ operation: "queue:default" });

    const priorities: Priority[] = ["critical", "high", "medium", "low"];
    for (const p of priorities) {
      const qname = `${QUEUE_NAME}-${p}`;
      this.queues[qname] = new Queue(qname, {
        connection,
        defaultJobOptions: {
          attempts: retryPolicy.maxRetries + 1,
          backoff: retryPolicyService.getBullMQBackoff({ operation: "queue:default" }),
          removeOnComplete: true,
          removeOnFail: false,
        },
        // rate limiting can be configured per priority via environment
        limiter: {
          max: Number(process.env[`QUEUE_RATE_MAX_${p.toUpperCase()}`] || 1000),
          duration: Number(process.env[`QUEUE_RATE_DURATION_MS_${p.toUpperCase()}`] || 1000),
        },
      } as any);
    }
  }

  public static getInstance(): JobQueue {
    if (!JobQueue.instance) {
      JobQueue.instance = new JobQueue();
    }
    return JobQueue.instance;
  }

  private queueForPriority(priority?: Priority) {
    const p: Priority = priority || "medium";
    return this.queues[`${QUEUE_NAME}-${p}`];
  }

  public async addJob(name: string, data: unknown, options: Record<string, any> = {}) {
    const priority: Priority | undefined = options.priority;
    const q = this.queueForPriority(priority);
    logger.info({ jobName: name, priority: priority ?? "medium" }, "Adding job to prioritized queue");
    // remove priority from options since bullmq uses numeric priority separately
    const opts = { ...options };
    delete opts.priority;
    return q.add(name, data, opts);
  }

  public async addRepeatableJob(name: string, data: unknown, cron: string, priority?: Priority) {
    const q = this.queueForPriority(priority);
    logger.info({ jobName: name, cron, priority: priority ?? "medium" }, "Scheduling repeatable job");
    return q.add(name, data, {
      repeat: { pattern: cron },
    });
  }

  /**
   * Initialise one Worker per priority queue so that all queues are drained
   * concurrently rather than only the first queue being served.
   *
   * Each worker emits Prometheus metrics on every completed/failed event and
   * updates the active/waiting gauges via a periodic poll.
   */
  public initWorker(processor: (job: Job) => Promise<void>) {
    if (this.workers.length > 0) return;

    const metrics = getMetricsService();

    for (const queueName of Object.keys(this.queues)) {
      const worker = new Worker(
        queueName,
        async (job: Job) => {
          const start = Date.now();

          // Increment in-flight gauge for this queue + job type
          metrics.queueJobsActive.inc({ queue_name: queueName, job_type: job.name });

          try {
            await processor(job);
          } finally {
            // Always decrement in-flight even if the processor throws so that
            // BullMQ's own failed-event handler can still fire cleanly.
            metrics.queueJobsActive.dec({ queue_name: queueName, job_type: job.name });

            const durationSeconds = (Date.now() - start) / 1000;
            metrics.queueJobDuration.observe(
              { queue_name: queueName, job_type: job.name },
              durationSeconds,
            );
          }
        },
        { connection, concurrency: 5 },
      );

      worker.on("completed", (job: Job) => {
        logger.info({ jobId: job.id, jobName: job.name, queueName }, "Job completed successfully");
        metrics.queueJobsCompleted.inc({ queue_name: queueName, job_type: job.name });
      });

      worker.on("failed", (job: Job | undefined, err: Error) => {
        logger.error(
          { jobId: job?.id, jobName: job?.name, queueName, error: err.message },
          "Job failed",
        );
        // Classify the error by its constructor name for finer-grained alerting
        const errorType = err?.constructor?.name ?? "UnknownError";
        metrics.queueJobsFailed.inc({
          queue_name: queueName,
          job_type: job?.name ?? "unknown",
          error_type: errorType,
        });
      });

      this.workers.push(worker);
    }

    // Start periodic gauge polling for queue depth (waiting) across all queues
    this.startGaugePolling();
  }

  /**
   * Poll BullMQ for queue-depth counts and push them to the waiting gauge.
   * This is done on a timer rather than per-event because BullMQ does not emit
   * a "waiting" event for every enqueue operation.
   */
  private startGaugePolling() {
    const metrics = getMetricsService();

    for (const [queueName, queue] of Object.entries(this.queues)) {
      const poller = setInterval(async () => {
        try {
          const counts = await queue.getJobCounts("waiting", "active", "delayed");
          metrics.queueJobsWaiting.set({ queue_name: queueName, job_type: "all" }, counts.waiting ?? 0);
          // active count from BullMQ as a cross-check (the per-job gauge is the
          // authoritative in-flight metric, but this catches any drift)
          metrics.queueJobsActive.set({ queue_name: queueName, job_type: "all" }, counts.active ?? 0);
        } catch (err) {
          logger.warn({ queueName, err }, "Failed to poll queue counts for metrics");
        }
      }, GAUGE_POLL_INTERVAL_MS);

      // Allow Node to exit cleanly even if the poller is still running
      poller.unref();
      this.gaugePollers.push(poller);
    }
  }

  public async getJobCounts() {
    // aggregate counts across queues
    const keys = Object.keys(this.queues);
    const counts = {} as Record<string, any>;
    for (const k of keys) {
      counts[k] = await this.queues[k].getJobCounts();
    }
    return counts;
  }

  public async getFailedJobs() {
    const keys = Object.keys(this.queues);
    let combined: any[] = [];
    for (const k of keys) {
      combined = combined.concat(await this.queues[k].getFailed(0, 100));
    }
    return combined;
  }

  public async stop() {
    // Stop gauge pollers first
    for (const t of this.gaugePollers) {
      clearInterval(t);
    }
    this.gaugePollers = [];

    for (const worker of this.workers) {
      await worker.close();
    }
    this.workers = [];

    for (const k of Object.keys(this.queues)) {
      await this.queues[k].close();
    }
    logger.info("Job queue system shut down");
  }

  public async pause(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.pause()));
  }
}
