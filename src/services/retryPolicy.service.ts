import { config } from "../config/index.js";
import { getMetricsService } from "../utils/metrics.js";

export type RetryFailureClass = "transient" | "rate_limit" | "timeout" | "permanent";

export interface RetryPolicyConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterRatio: number;
}

export interface RetryOperationOverride {
  operation: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterRatio?: number;
}

export class RetryPolicyService {
  private readonly metrics = getMetricsService();
  private readonly defaults: RetryPolicyConfig;

  constructor(defaults?: Partial<RetryPolicyConfig>) {
    this.defaults = {
      maxRetries: defaults?.maxRetries ?? Math.max(0, config.RETRY_MAX ?? 3),
      baseDelayMs: defaults?.baseDelayMs ?? 1000,
      maxDelayMs: defaults?.maxDelayMs ?? 60_000,
      backoffMultiplier: defaults?.backoffMultiplier ?? 2,
      jitterRatio: defaults?.jitterRatio ?? 0.2,
    };
  }

  getPolicy(override?: Partial<RetryOperationOverride>): RetryPolicyConfig {
    return {
      maxRetries: Math.max(0, override?.maxRetries ?? this.defaults.maxRetries),
      baseDelayMs: Math.max(1, override?.baseDelayMs ?? this.defaults.baseDelayMs),
      maxDelayMs: Math.max(1, override?.maxDelayMs ?? this.defaults.maxDelayMs),
      backoffMultiplier: Math.max(1, override?.backoffMultiplier ?? this.defaults.backoffMultiplier),
      jitterRatio: Math.max(0, Math.min(1, override?.jitterRatio ?? this.defaults.jitterRatio)),
    };
  }

  classifyFailure(error: unknown): RetryFailureClass {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("429") || message.includes("rate limit")) return "rate_limit";
    if (message.includes("timeout")) return "timeout";
    if (message.includes("validation") || message.includes("forbidden") || message.includes("unauthorized")) {
      return "permanent";
    }
    return "transient";
  }

  isRetryable(error: unknown): boolean {
    return this.classifyFailure(error) !== "permanent";
  }

  getDelayMs(attempt: number, override?: Partial<RetryOperationOverride>): number {
    const policy = this.getPolicy(override);
    const exponential = Math.min(
      policy.maxDelayMs,
      Math.floor(policy.baseDelayMs * policy.backoffMultiplier ** Math.max(0, attempt - 1)),
    );
    const jitterWindow = Math.floor(exponential * policy.jitterRatio);
    const jitter = jitterWindow > 0 ? Math.floor((Math.random() * (jitterWindow * 2 + 1)) - jitterWindow) : 0;
    return Math.max(1, exponential + jitter);
  }

  recordRetryMetric(operation: string, status: "scheduled" | "exhausted", attempt: number, failureClass: RetryFailureClass): void {
    this.metrics.recordCustomMetric("retry_attempt_total", 1, "count", {
      operation,
      status,
      attempt: String(attempt),
      failureClass,
    });
  }

  getBullMQBackoff(override?: Partial<RetryOperationOverride>): { type: "exponential"; delay: number } {
    const policy = this.getPolicy(override);
    return {
      type: "exponential",
      delay: policy.baseDelayMs,
    };
  }
}

export const retryPolicyService = new RetryPolicyService();
