import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertWindowingService } from "../../src/services/alertWindowing.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const b: Record<string, unknown> = {};
    b.where = vi.fn().mockReturnValue(b);
    b.orderBy = vi.fn().mockReturnValue(b);
    b.insert = vi.fn().mockReturnValue(b);
    b.update = vi.fn().mockReturnValue(b);
    b.first = vi.fn().mockResolvedValue(null);
    b.returning = vi.fn().mockResolvedValue([]);
    b.limit = vi.fn().mockReturnValue(b);
    b.offset = vi.fn().mockResolvedValue([]);
    const fn = (_t: string) => b;
    return fn;
  }),
}));

describe("AlertWindowingService", () => {
  let service: AlertWindowingService;

  beforeEach(() => {
    (AlertWindowingService as any).instance = undefined;
    service = AlertWindowingService.getInstance();
    vi.clearAllMocks();
  });

  describe("determineWindowKey", () => {
    it("generates a composite key from assetCode and alertType", () => {
      const key = service.determineWindowKey({
        assetCode: "USDC",
        alertType: "price_deviation",
      });
      expect(key).toBe("USDC::price_deviation");
    });
  });

  describe("getWindow", () => {
    it("returns null for unknown window", async () => {
      const window = await service.getWindow("nonexistent");
      expect(window).toBeNull();
    });
  });

  describe("listWindows", () => {
    it("returns empty array when no windows", async () => {
      const windows = await service.listWindows();
      expect(windows).toEqual([]);
    });
  });

  describe("assignToWindow", () => {
    it("creates a new window when no matching window exists", async () => {
      const window = await service.assignToWindow({
        id: "alert-1",
        ruleId: "rule-1",
        assetCode: "USDC",
        alertType: "price_deviation",
        priority: "high",
        triggeredValue: 150,
        threshold: 100,
        occurredAt: new Date(),
      });

      expect(window.assetCode).toBe("USDC");
      expect(window.alertType).toBe("price_deviation");
      expect(window.alertCount).toBe(1);
    });
  });

  describe("closeWindow", () => {
    it("returns null for unknown window", async () => {
      const window = await service.closeWindow("nonexistent");
      expect(window).toBeNull();
    });
  });

  describe("getSummary", () => {
    it("returns null for unknown window", async () => {
      const summary = await service.getSummary("nonexistent");
      expect(summary).toBeNull();
    });
  });

  describe("autoCloseExpiredWindows", () => {
    it("returns 0 when no expired windows", async () => {
      const count = await service.autoCloseExpiredWindows();
      expect(count).toBe(0);
    });
  });

  describe("setConfig", () => {
    it("updates window configuration", () => {
      service.setConfig({ windowMinutes: 30 });
      const key = service.determineWindowKey({
        assetCode: "BTC",
        alertType: "supply_mismatch",
      });
      expect(key).toBe("BTC::supply_mismatch");
    });
  });
});
