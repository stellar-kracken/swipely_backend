import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeHealthSnapshotService } from "../../src/services/bridgeHealthSnapshot.service.js";

vi.mock("../../src/services/bridge.service.js", () => ({
  BridgeService: class {
    getAllBridgeStatuses = vi.fn().mockResolvedValue({
      bridges: [
        {
          name: "circle",
          status: "healthy",
          lastChecked: "2026-05-30T00:00:00.000Z",
          totalValueLocked: 1000,
          mismatchPercentage: 0,
        },
        {
          name: "allbridge",
          status: "degraded",
          lastChecked: "2026-05-30T00:00:00.000Z",
          totalValueLocked: 500,
          mismatchPercentage: 0.01,
        },
      ],
    });
  },
}));

vi.mock("../../src/services/healthScoreHistory.service.js", () => ({
  HealthScoreHistoryService: class {
    getTrend = vi.fn().mockResolvedValue({
      current: 80,
      previous: 78,
      delta: 2,
      direction: "stable",
    });
  },
}));

vi.mock("../../src/utils/redis.js", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  },
}));

describe("BridgeHealthSnapshotService", () => {
  let service: BridgeHealthSnapshotService;

  beforeEach(() => {
    service = new BridgeHealthSnapshotService();
  });

  it("builds snapshot with overall status degraded when any bridge is degraded", async () => {
    const snapshot = await service.getSnapshot({ bypassCache: true });
    expect(snapshot.overallStatus).toBe("degraded");
    expect(snapshot.assetCoverage.total).toBe(2);
    expect(snapshot.assetCoverage.healthy).toBe(1);
    expect(snapshot.assetCoverage.degraded).toBe(1);
    expect(snapshot.bridges).toHaveLength(2);
    expect(snapshot.timestamp).toBeDefined();
  });
});
