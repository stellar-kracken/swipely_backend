import { Queue, Worker, Job, ConnectionOptions } from "bullmq";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { retryPolicyService } from "../services/retryPolicy.service.js";

const connection: ConnectionOptions = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
};

export const QUEUE_NAME = "bridge-watch-jobs";
export type Priority = "critical" | "high" | "medium" | "low";

export class JobQueue {
  private static instance: JobQueue;
  private queues: Record<string, Queue> = {};
  private worker: Worker | null = null;

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

  public initWorker(processor: (job: Job) => Promise<void>) {
    if (this.worker) return;

    // create a worker that listens on all priority queues by switching processor per queue
    const queueNames = Object.keys(this.queues);
    this.worker = new Worker(queueNames[0], async (job) => processor(job), {
      connection,
      concurrency: 5,
    });

    this.worker.on("completed", (job: Job) => {
      logger.info({ jobId: job.id, jobName: job.name }, "Job completed successfully");
    });

    this.worker.on("failed", (job: Job | undefined, err: Error) => {
      logger.error({ jobId: job?.id, jobName: job?.name, error: err.message }, "Job failed");
    });
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
    if (this.worker) {
      await this.worker.close();
    }
    for (const k of Object.keys(this.queues)) {
      await this.queues[k].close();
    }
    logger.info("Job queue system shut down");
  }
}
