import { describe, expect, it } from "vitest";
import {
  getPropagationHeaders,
  getRequestContext,
  runWithRequestContext,
} from "../../src/utils/requestContext.js";

describe("requestContext", () => {
  it("returns undefined outside of a request context", () => {
    expect(getRequestContext()).toBeUndefined();
    expect(getPropagationHeaders()).toEqual({});
  });

  it("exposes the active context within runWithRequestContext", () => {
    runWithRequestContext(
      {
        requestId: "req-1",
        correlationId: "corr-1",
        traceId: "trace-1",
        spanId: "span-1",
        userId: "user-1",
      },
      () => {
        expect(getRequestContext()).toEqual({
          requestId: "req-1",
          correlationId: "corr-1",
          traceId: "trace-1",
          spanId: "span-1",
          userId: "user-1",
        });
      }
    );
  });

  it("builds propagation headers from the active context", () => {
    runWithRequestContext(
      {
        requestId: "req-2",
        correlationId: "corr-2",
        traceId: "trace-2",
        spanId: "span-2",
      },
      () => {
        expect(getPropagationHeaders()).toEqual({
          "x-request-id": "req-2",
          "x-correlation-id": "corr-2",
          "x-trace-id": "trace-2",
          "x-parent-span-id": "span-2",
        });
      }
    );
  });

  it("propagates context across an async continuation", async () => {
    await runWithRequestContext(
      {
        requestId: "req-3",
        correlationId: "corr-3",
        traceId: "trace-3",
        spanId: "span-3",
      },
      async () => {
        await Promise.resolve();
        expect(getRequestContext()?.requestId).toBe("req-3");
      }
    );
  });

  it("does not leak context after runWithRequestContext returns", () => {
    runWithRequestContext(
      { requestId: "req-4", correlationId: "corr-4", traceId: "trace-4", spanId: "span-4" },
      () => {}
    );
    expect(getRequestContext()).toBeUndefined();
  });
});
