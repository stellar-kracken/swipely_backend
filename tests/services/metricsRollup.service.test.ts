import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MetricsRollupService } from "../../src/services/metricsRollup.service.js";

const createQueryBuilder = (rows: any[] = []) => {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    sum: vi.fn().mockReturnThis(),
    avg: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    merge: vi.fn().mockResolvedValue([1]),
    then: (resolve: (value: any) => any) => resolve(rows),
  };
  return builder;
};

const mockKnex = vi.hoisted(() => {
  const knex: any = vi.fn((table: string) => {
    return createQueryBuilder([]);
  });
  knex.raw = vi.fn((sql: string) => sql);
  return knex;
});

vi.mock("../../src/database/connection.js", () => {
  return {
    getDatabase: () => mockKnex,
  };
});

describe("MetricsRollupService", () => {
  let rollupService: MetricsRollupService;

  beforeEach(() => {
    rollupService = new MetricsRollupService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rollupBridgeVolume", () => {
    it("should aggregate transactions and update stats", async () => {
      const mockAggregations = [
        {
          bridge_name: "Circle",
          symbol: "USDC",
          inflow: "1000",
          outflow: "400",
          tx_count: "5",
          avg_size: "200",
        },
      ];

      // Setup mock to return aggregations
      mockKnex.mockImplementation((table: string) => {
        if (table === "bridge_transactions") {
          return createQueryBuilder(mockAggregations);
        }
        return createQueryBuilder([]);
      });

      const date = new Date("2024-01-01T00:00:00Z");
      const updatedCount = await rollupService.rollupBridgeVolume(date);

      expect(updatedCount).toBe(1);
      expect(mockKnex).toHaveBeenCalledWith("bridge_transactions");
      expect(mockKnex).toHaveBeenCalledWith("bridge_volume_stats");
    });

    it("should handle empty transactions for a date", async () => {
      mockKnex.mockImplementation(() => createQueryBuilder([]));

      const date = new Date("2024-01-01T00:00:00Z");
      const updatedCount = await rollupService.rollupBridgeVolume(date);

      expect(updatedCount).toBe(0);
    });

    it("should throw error if database query fails", async () => {
      mockKnex.mockImplementation(() => {
        throw new Error("DB Error");
      });

      await expect(rollupService.rollupBridgeVolume()).rejects.toThrow("DB Error");
    });
  });

  describe("rollupRange", () => {
    it("should call rollupBridgeVolume for each day in range", async () => {
      const spy = vi.spyOn(rollupService, "rollupBridgeVolume").mockResolvedValue(1);
      
      const startDate = new Date("2024-01-01T00:00:00Z");
      const endDate = new Date("2024-01-03T00:00:00Z");
      
      await rollupService.rollupRange(startDate, endDate);
      
      expect(spy).toHaveBeenCalledTimes(3); // 01, 02, 03
    });
  });
});
