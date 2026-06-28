import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetryPolicyService } from "../../src/services/retryPolicy.service.js";

const recordCustomMetricMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/config/index.js", () => ({
  config: { RETRY_MAX: 3 },
}));

vi.mock("../../src/utils/metrics.js", () => ({
  getMetricsService: () => ({
    recordCustomMetric: recordCustomMetricMock,
  }),
}));

describe("RetryPolicyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes default policy and per-operation overrides", () => {
    const service = new RetryPolicyService({
      maxRetries: -2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      backoffMultiplier: 0.5,
      jitterRatio: 2,
    });

    expect(service.getPolicy()).toEqual({
      maxRetries: 0,
      baseDelayMs: 1,
      maxDelayMs: 1,
      backoffMultiplier: 1,
      jitterRatio: 1,
    });

    expect(
      service.getPolicy({
        operation: "price-sync",
        maxRetries: 5,
        baseDelayMs: 250,
        maxDelayMs: 10_000,
        backoffMultiplier: 3,
        jitterRatio: 0.1,
      }),
    ).toEqual({
      maxRetries: 5,
      baseDelayMs: 250,
      maxDelayMs: 10_000,
      backoffMultiplier: 3,
      jitterRatio: 0.1,
    });
  });

  it("calculates exponential backoff and caps delays at the max", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const service = new RetryPolicyService({
      baseDelayMs: 100,
      maxDelayMs: 500,
      backoffMultiplier: 2,
      jitterRatio: 0,
    });

    expect(service.getDelayMs(1)).toBe(100);
    expect(service.getDelayMs(2)).toBe(200);
    expect(service.getDelayMs(3)).toBe(400);
    expect(service.getDelayMs(4)).toBe(500);
    expect(service.getDelayMs(0)).toBe(100);
  });

  it("applies deterministic jitter within the configured window", () => {
    const service = new RetryPolicyService({
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      backoffMultiplier: 2,
      jitterRatio: 0.2,
    });

    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.999).mockReturnValueOnce(0.5);

    expect(service.getDelayMs(2)).toBe(160);
    expect(service.getDelayMs(2)).toBe(240);
    expect(service.getDelayMs(2)).toBe(200);
  });

  it("classifies retryable and permanent failures", () => {
    const service = new RetryPolicyService();

    expect(service.classifyFailure(new Error("HTTP 429 rate limit exceeded"))).toBe("rate_limit");
    expect(service.classifyFailure(new Error("request timeout"))).toBe("timeout");
    expect(service.classifyFailure(new Error("forbidden"))).toBe("permanent");
    expect(service.classifyFailure("socket reset")).toBe("transient");

    expect(service.isRetryable(new Error("unauthorized"))).toBe(false);
    expect(service.isRetryable(new Error("temporary outage"))).toBe(true);
  });

  it("records retry metrics and exposes BullMQ exponential backoff", () => {
    const service = new RetryPolicyService({ baseDelayMs: 750 });

    service.recordRetryMetric("reserve-check", "exhausted", 4, "timeout");

    expect(recordCustomMetricMock).toHaveBeenCalledWith("retry_attempt_total", 1, "count", {
      operation: "reserve-check",
      status: "exhausted",
      attempt: "4",
      failureClass: "timeout",
    });
    expect(service.getBullMQBackoff({ operation: "reserve-check", baseDelayMs: 1250 })).toEqual({
      type: "exponential",
      delay: 1250,
    });
  });
});
