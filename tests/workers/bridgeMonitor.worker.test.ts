import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
const verifySupplyMock = vi.hoisted(() => vi.fn());
const routeAlertMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const checkDedupMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({ isDuplicate: false, action: "allow" })
);
const dbInsertMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const dbTableMock = vi.hoisted(() => vi.fn(() => ({ insert: dbInsertMock })));

vi.mock("../../src/services/bridge.service.js", () => ({
  BridgeService: class {
    verifySupply = verifySupplyMock;
  },
}));

vi.mock("../../src/services/alertRouting.service.js", () => ({
  alertRoutingService: { routeAlert: routeAlertMock },
}));

vi.mock("../../src/services/duplicateAlertCheck.service.js", () => ({
  duplicateAlertCheckService: { check: checkDedupMock },
}));

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => dbTableMock,
}));

vi.mock("bullmq", () => ({
  Worker: class {
    on() {}
  },
  Queue: class {
    add = vi.fn().mockResolvedValue({ id: "mock-job" });
    on() {}
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    REDIS_HOST: "localhost",
    REDIS_PORT: 6379,
    BRIDGE_MISMATCH_THRESHOLD: 0.01,
  },
}));

// Import the processor function under test
import { processMonitorJob } from "../../src/workers/bridgeMonitor.worker.js";

describe("bridgeMonitor.worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkDedupMock.mockReturnValue({ isDuplicate: false, action: "allow" });
  });

  describe("supply match path", () => {
    it("returns success when supply matches", async () => {
      verifySupplyMock.mockResolvedValue({ match: true, mismatchPercentage: 0 });

      const result = await processMonitorJob({ id: "job-1", data: { assetCode: "USDC" } } as any);

      expect(result.success).toBe(true);
      expect(result.assetCode).toBe("USDC");
    });

    it("does not trigger alert when supply matches", async () => {
      verifySupplyMock.mockResolvedValue({ match: true, mismatchPercentage: 0 });

      await processMonitorJob({ id: "job-1", data: { assetCode: "USDC" } } as any);

      expect(routeAlertMock).not.toHaveBeenCalled();
    });
  });

  describe("supply mismatch alert path", () => {
    it("routes alert when supply mismatches and not duplicate", async () => {
      verifySupplyMock.mockResolvedValue({ match: false, mismatchPercentage: 0.05 });

      await processMonitorJob({ id: "job-2", data: { assetCode: "USDC" } } as any);

      expect(routeAlertMock).toHaveBeenCalledOnce();
      expect(routeAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          assetCode: "USDC",
          sourceType: "supply_mismatch",
          severity: "high",
        })
      );
    });

    it("alert contains correct triggeredValue and metric", async () => {
      verifySupplyMock.mockResolvedValue({ match: false, mismatchPercentage: 0.08 });

      await processMonitorJob({ id: "job-3", data: { assetCode: "EURC" } } as any);

      const call = routeAlertMock.mock.calls[0][0];
      expect(call.triggeredValue).toBeCloseTo(0.08);
      expect(call.metric).toBe("supply_mismatch_pct");
    });
  });

  describe("deduplication", () => {
    it("suppresses alert when duplicate check blocks", async () => {
      verifySupplyMock.mockResolvedValue({ match: false, mismatchPercentage: 0.05 });
      checkDedupMock.mockReturnValue({ isDuplicate: true, action: "block", reason: "within window" });

      await processMonitorJob({ id: "job-4", data: { assetCode: "USDC" } } as any);

      expect(routeAlertMock).not.toHaveBeenCalled();
    });

    it("allows alert when duplicate check escalates", async () => {
      verifySupplyMock.mockResolvedValue({ match: false, mismatchPercentage: 0.05 });
      checkDedupMock.mockReturnValue({ isDuplicate: true, action: "escalate" });

      await processMonitorJob({ id: "job-5", data: { assetCode: "USDC" } } as any);

      expect(routeAlertMock).toHaveBeenCalledOnce();
    });

    it("passes correct event fields to duplicate check", async () => {
      verifySupplyMock.mockResolvedValue({ match: false, mismatchPercentage: 0.03 });

      await processMonitorJob({ id: "job-6", data: { assetCode: "EURC" } } as any);

      expect(checkDedupMock).toHaveBeenCalledWith(
        expect.objectContaining({
          assetCode: "EURC",
          alertType: "supply_mismatch",
          priority: "high",
        })
      );
    });
  });

  describe("persistence", () => {
    it("persists monitoring result after every job", async () => {
      verifySupplyMock.mockResolvedValue({ match: true, mismatchPercentage: 0 });

      await processMonitorJob({ id: "job-7", data: { assetCode: "USDC" } } as any);

      expect(dbTableMock).toHaveBeenCalledWith("bridge_monitor_results");
      expect(dbInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ asset_code: "USDC", supply_match: true })
      );
    });

    it("persists mismatch result with correct fields", async () => {
      verifySupplyMock.mockResolvedValue({ match: false, mismatchPercentage: 0.07 });

      await processMonitorJob({ id: "job-8", data: { assetCode: "USDC" } } as any);

      expect(dbInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ supply_match: false, mismatch_pct: 0.07 })
      );
    });

    it("continues even when persistence fails", async () => {
      verifySupplyMock.mockResolvedValue({ match: true, mismatchPercentage: 0 });
      dbInsertMock.mockRejectedValueOnce(new Error("DB down"));

      const result = await processMonitorJob({ id: "job-9", data: { assetCode: "USDC" } } as any);

      expect(result.success).toBe(true);
    });

    it("persists stellar and evm supply values when present", async () => {
      verifySupplyMock.mockResolvedValue({
        match: false,
        mismatchPercentage: 0.02,
        stellarSupply: 1_000_000,
        evmSupply: 980_000,
      });

      await processMonitorJob({ id: "job-10", data: { assetCode: "USDC" } } as any);

      expect(dbInsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          stellar_supply: 1_000_000,
          evm_supply: 980_000,
        })
      );
    });
  });

  describe("alert routing resilience", () => {
    it("throws and propagates error when routeAlert fails", async () => {
      verifySupplyMock.mockResolvedValue({ match: false, mismatchPercentage: 0.05 });
      routeAlertMock.mockRejectedValueOnce(new Error("alert service unavailable"));

      await expect(
        processMonitorJob({ id: "job-11", data: { assetCode: "USDC" } } as any)
      ).rejects.toThrow("alert service unavailable");
    });

    it("returns supplyCheck data in the result object", async () => {
      const supplyCheck = { match: true, mismatchPercentage: 0, stellarSupply: 500_000, evmSupply: 500_000 };
      verifySupplyMock.mockResolvedValue(supplyCheck);

      const result = await processMonitorJob({ id: "job-12", data: { assetCode: "EURC" } } as any);

      expect(result.supplyCheck).toMatchObject(supplyCheck);
    });
  });
});
