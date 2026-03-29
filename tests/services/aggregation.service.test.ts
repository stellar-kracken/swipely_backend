import { describe, it, expect, vi, beforeEach } from "vitest";
import { AggregationService } from "../../src/services/aggregation.service";

vi.mock("../../src/database/connection", () => ({
  getDatabase: vi.fn(() => ({
    raw: vi.fn().mockResolvedValue({ rows: [] }),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("../../src/utils/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    del: vi.fn(),
    ttl: vi.fn().mockResolvedValue(-1),
  },
}));

vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("AggregationService", () => {
  let aggregationService: AggregationService;

  beforeEach(() => {
    aggregationService = new AggregationService();
    vi.clearAllMocks();
  });

  describe("aggregatePrices", () => {
    it("should return empty array when no data", async () => {
      const result = await aggregationService.aggregatePrices(
        "USDC",
        "1h",
        new Date("2024-01-01"),
        new Date("2024-01-02"),
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("aggregateHealthScores", () => {
    it("should return empty array when no data", async () => {
      const result = await aggregationService.aggregateHealthScores(
        "USDC",
        "1h",
        new Date("2024-01-01"),
        new Date("2024-01-02"),
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getAggregationStats", () => {
    it("should return stats object", async () => {
      const result = await aggregationService.getAggregationStats();
      expect(result).toHaveProperty("cachedAggregations");
      expect(result).toHaveProperty("cacheSize");
      expect(result).toHaveProperty("intervals");
    });
  });
});
