import { describe, it, expect, vi } from "vitest";
import {
  HorizonStreamSupervisor,
  HorizonStreamManager,
} from "../../src/services/horizonStreamSupervisor.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/services/metrics.service.js", () => ({
  getMetricsService: vi.fn(() => null),
}));

describe("HorizonStreamSupervisor", () => {
  it("initialises with correct defaults", () => {
    const supervisor = new HorizonStreamSupervisor({
      streamId: "test-stream",
      url: "https://horizon.stellar.org/transactions",
    });
    const metrics = supervisor.getHealthMetrics();
    expect(metrics.streamId).toBe("test-stream");
    expect(metrics.reconnectCount).toBe(0);
    expect(metrics.gapDetected).toBe(false);
  });

  it("getCheckpoint returns initial state", () => {
    const supervisor = new HorizonStreamSupervisor({
      streamId: "test-stream",
      url: "https://horizon.stellar.org/transactions",
      cursor: "abc123",
    });
    const checkpoint = supervisor.getCheckpoint();
    expect(checkpoint.streamId).toBe("test-stream");
    expect(checkpoint.lastCursor).toBe("abc123");
  });

  it("stop() does not throw", () => {
    const supervisor = new HorizonStreamSupervisor({
      streamId: "test-stream",
      url: "https://horizon.stellar.org/transactions",
    });
    expect(() => supervisor.stop()).not.toThrow();
  });
});

describe("HorizonStreamManager", () => {
  it("starts with empty list", () => {
    const manager = new HorizonStreamManager();
    expect(manager.list()).toHaveLength(0);
  });

  it("throws on duplicate streamId", () => {
    const manager = new HorizonStreamManager();
    // Mock start() to avoid actual fetch
    vi.spyOn(HorizonStreamSupervisor.prototype, "start").mockImplementation(() => undefined);
    manager.add({ streamId: "dup", url: "https://example.com" });
    expect(() => manager.add({ streamId: "dup", url: "https://example.com" })).toThrow();
    manager.stopAll();
  });

  it("remove returns false for unknown streamId", () => {
    const manager = new HorizonStreamManager();
    expect(manager.remove("non-existent")).toBe(false);
  });

  it("remove returns true for known streamId", () => {
    const manager = new HorizonStreamManager();
    vi.spyOn(HorizonStreamSupervisor.prototype, "start").mockImplementation(() => undefined);
    manager.add({ streamId: "s1", url: "https://example.com" });
    expect(manager.remove("s1")).toBe(true);
    expect(manager.list()).toHaveLength(0);
  });
});
