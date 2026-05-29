import { describe, it, expect } from "vitest";
import {
  windowStartFor,
  aggregateTumbling,
  aggregateSliding,
  aggregateWindows,
  type DataPoint,
} from "../../src/services/aggregationWindow.js";

const points: DataPoint[] = [
  { timestamp: 0, value: 10 },
  { timestamp: 500, value: 20 },
  { timestamp: 1000, value: 30 }, // boundary → next window
  { timestamp: 1500, value: 40 },
  { timestamp: 2500, value: 50 }, // gap leaves window [2000,3000) with only this
];

describe("aggregationWindow", () => {
  it("aligns window starts to the origin and floors deterministically", () => {
    expect(windowStartFor(1499, { sizeMs: 1000 })).toBe(1000);
    expect(windowStartFor(1000, { sizeMs: 1000 })).toBe(1000);
    expect(windowStartFor(1700, { sizeMs: 1000, originMs: 200 })).toBe(1200);
  });

  it("buckets points into tumbling windows with half-open boundaries", () => {
    const windows = aggregateTumbling(points, { sizeMs: 1000 });
    expect(windows.map((w) => [w.start, w.end, w.count])).toEqual([
      [0, 1000, 2],
      [1000, 2000, 2],
      [2000, 3000, 1],
    ]);
    expect(windows[0]).toMatchObject({ sum: 30, min: 10, max: 20, avg: 15 });
    expect(windows[2]).toMatchObject({ sum: 50, min: 50, max: 50, avg: 50 });
  });

  it("produces overlapping sliding windows that advance by stepMs", () => {
    const windows = aggregateSliding(points, { sizeMs: 1000, stepMs: 500 });
    // First window covers [0,1000): the two sub-second points.
    expect(windows[0]).toMatchObject({ start: 0, end: 1000, count: 2, sum: 30 });
    // Second window covers [500,1500): the 500 and 1000 points.
    expect(windows[1]).toMatchObject({ start: 500, end: 1500, count: 2, sum: 50 });
    expect(windows.length).toBeGreaterThan(aggregateTumbling(points, { sizeMs: 1000 }).length);
  });

  it("returns an empty array for no points and dispatches by type", () => {
    expect(aggregateWindows([], "tumbling", { sizeMs: 1000 })).toEqual([]);
    expect(aggregateWindows(points, "sliding", { sizeMs: 1000, stepMs: 500 })[0].count).toBe(2);
  });

  it("validates the window configuration", () => {
    expect(() => aggregateTumbling(points, { sizeMs: 0 })).toThrow(/sizeMs/);
    expect(() => aggregateSliding(points, { sizeMs: 1000, stepMs: -1 })).toThrow(/stepMs/);
  });
});
