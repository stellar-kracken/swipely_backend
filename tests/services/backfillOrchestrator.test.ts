import { describe, it, expect, vi } from "vitest";
import {
  planChunks,
  runBackfill,
  type BackfillChunk,
  type BackfillEvent,
} from "../../src/services/backfillOrchestrator.js";

const noSleep = () => Promise.resolve();

describe("planChunks", () => {
  it("splits the range into ordered chunks and clamps the last one", () => {
    expect(planChunks({ rangeStart: 0, rangeEnd: 250, chunkSize: 100 })).toEqual([
      { index: 0, from: 0, to: 100 },
      { index: 1, from: 100, to: 200 },
      { index: 2, from: 200, to: 250 },
    ]);
  });

  it("validates the range and chunk size", () => {
    expect(() => planChunks({ rangeStart: 10, rangeEnd: 5, chunkSize: 1 })).toThrow(/rangeEnd/);
    expect(() => planChunks({ rangeStart: 0, rangeEnd: 5, chunkSize: 0 })).toThrow(/chunkSize/);
  });
});

describe("runBackfill", () => {
  it("processes every chunk and reports completion", async () => {
    const processed: number[] = [];
    const result = await runBackfill(
      { rangeStart: 0, rangeEnd: 300, chunkSize: 100, concurrency: 2 },
      { processChunk: async (c) => void processed.push(c.index), sleep: noSleep },
    );
    expect(result.completedChunks).toEqual([0, 1, 2]);
    expect(result.failedChunks).toEqual([]);
    expect(processed.sort()).toEqual([0, 1, 2]);
  });

  it("skips already-completed chunks (resume support)", async () => {
    const processChunk = vi.fn(async () => {});
    const result = await runBackfill(
      { rangeStart: 0, rangeEnd: 300, chunkSize: 100, completedChunks: [0] },
      { processChunk, sleep: noSleep },
    );
    expect(processChunk).toHaveBeenCalledTimes(2); // chunks 1 and 2 only
    expect(result.completedChunks).toEqual([0, 1, 2]);
  });

  it("retries a transient failure then succeeds", async () => {
    let attempts = 0;
    const result = await runBackfill(
      { rangeStart: 0, rangeEnd: 100, chunkSize: 100, maxRetries: 2 },
      {
        processChunk: async () => {
          attempts += 1;
          if (attempts < 2) throw new Error("flaky provider");
        },
        sleep: noSleep,
      },
    );
    expect(attempts).toBe(2);
    expect(result.completedChunks).toEqual([0]);
    expect(result.failedChunks).toEqual([]);
  });

  it("gives up after maxRetries and records the chunk as failed", async () => {
    const events: BackfillEvent[] = [];
    const result = await runBackfill(
      { rangeStart: 0, rangeEnd: 100, chunkSize: 100, maxRetries: 1 },
      {
        processChunk: async () => {
          throw new Error("permanent");
        },
        sleep: noSleep,
        onEvent: (e) => events.push(e),
      },
    );
    expect(result.failedChunks).toEqual([0]);
    expect(events.some((e) => e.type === "chunk-failed")).toBe(true);
    // 1 initial attempt + 1 retry = 2 chunk-start events
    expect(events.filter((e) => e.type === "chunk-start").length).toBe(2);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runBackfill(
      { rangeStart: 0, rangeEnd: 1000, chunkSize: 100, concurrency: 3 },
      {
        processChunk: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Promise.resolve();
          inFlight -= 1;
        },
        sleep: noSleep,
      },
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("applies the rate-limit delay before dispatching chunks", async () => {
    const sleep = vi.fn(async () => {});
    await runBackfill(
      { rangeStart: 0, rangeEnd: 200, chunkSize: 100, minDelayMs: 50 },
      { processChunk: async () => {}, sleep },
    );
    expect(sleep).toHaveBeenCalledWith(50);
  });
});
