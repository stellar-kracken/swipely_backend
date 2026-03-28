import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { AnalyticsService } from "../../src/services/analytics.service.js";
import { knex } from "../../src/database/connection.js";
import { redis } from "../../src/utils/redis.js";

vi.mock("../../src/utils/redis.js", () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
  },
}));

describe("AnalyticsService", () => {
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    analyticsService = new AnalyticsService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getProtocolStats", () => {
    it("should return cached protocol stats if available", async () => {
      const cachedStats = {
        totalValueLocked: "1000000",
        totalVolume24h: "500000",
        activeBridges: 5,
        activeAssets: 10,
        timestamp: new Date().toISOString(),
      };

      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedStats));

      const result = await analyticsService.getProtocolStats();

      expect(redis.get).toHaveBeenCalledWith("analytics:protocol:stats");
      expect(result).toEqual(cachedStats);
    });

    it("should compute and cache protocol stats if not cached", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue("OK");

      const result = await analyticsService.getProtocolStats();

      expect(result).toHaveProperty("totalValueLocked");
      expect(result).toHaveProperty("totalVolume24h");
      expect(result).toHaveProperty("activeBridges");
      expect(result).toHaveProperty("activeAssets");
      expect(result).toHaveProperty("timestamp");
      expect(redis.setex).toHaveBeenCalled();
    });
  });

  describe("getBridgeComparisons", () => {
    it("should return cached bridge comparisons if available", async () => {
      const cachedComparisons = [
        {
          bridgeName: "Circle USDC",
          tvl: "500000",
          volume24h: "100000",
          status: "healthy",
          marketShare: 50,
        },
      ];

      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedComparisons));

      const result = await analyticsService.getBridgeComparisons();

      expect(redis.get).toHaveBeenCalledWith("analytics:bridges:comparison");
      expect(result).toEqual(cachedComparisons);
    });

    it("should compute bridge comparisons with market share", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue("OK");

      const result = await analyticsService.getBridgeComparisons();

      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0]).toHaveProperty("bridgeName");
        expect(result[0]).toHaveProperty("tvl");
        expect(result[0]).toHaveProperty("marketShare");
        expect(result[0]).toHaveProperty("trend");
      }
    });
  });

  describe("getAssetRankings", () => {
    it("should return cached asset rankings if available", async () => {
      const cachedRankings = [
        {
          symbol: "USDC",
          rank: 1,
          healthScore: 95,
          tvl: "1000000",
          trend: "up",
        },
      ];

      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedRankings));

      const result = await analyticsService.getAssetRankings();

      expect(redis.get).toHaveBeenCalledWith("analytics:assets:rankings");
      expect(result).toEqual(cachedRankings);
    });

    it("should compute and rank assets by health score", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue("OK");

      const result = await analyticsService.getAssetRankings();

      expect(Array.isArray(result)).toBe(true);
      
      // Verify rankings are sequential
      result.forEach((ranking, index) => {
        expect(ranking.rank).toBe(index + 1);
      });

      // Verify sorted by health score descending
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].healthScore).toBeGreaterThanOrEqual(result[i + 1].healthScore);
      }
    });
  });

  describe("getVolumeAggregation", () => {
    it("should return cached volume aggregation if available", async () => {
      const cachedAggregation = [
        {
          period: "2024-01-01",
          totalVolume: "100000",
          inflowVolume: "60000",
          outflowVolume: "40000",
          transactionCount: 150,
        },
      ];

      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedAggregation));

      const result = await analyticsService.getVolumeAggregation("daily");

      expect(redis.get).toHaveBeenCalledWith("analytics:volume:daily:all:all");
      expect(result).toEqual(cachedAggregation);
    });

    it("should compute volume aggregation for different periods", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue("OK");

      const periods: Array<"hourly" | "daily" | "weekly" | "monthly"> = [
        "hourly",
        "daily",
        "weekly",
        "monthly",
      ];

      for (const period of periods) {
        const result = await analyticsService.getVolumeAggregation(period);
        expect(Array.isArray(result)).toBe(true);
      }
    });

    it("should filter by symbol and bridge name", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue("OK");

      const result = await analyticsService.getVolumeAggregation(
        "daily",
        "USDC",
        "Circle USDC"
      );

      expect(Array.isArray(result)).toBe(true);
      expect(redis.get).toHaveBeenCalledWith("analytics:volume:daily:USDC:Circle USDC");
    });
  });

  describe("calculateTrend", () => {
    it("should calculate health score trend for an asset", async () => {
      const result = await analyticsService.calculateTrend("health_score", "USDC");

      expect(result).toHaveProperty("metric", "health_score");
      expect(result).toHaveProperty("current");
      expect(result).toHaveProperty("previous");
      expect(result).toHaveProperty("change");
      expect(result).toHaveProperty("changePercent");
      expect(result).toHaveProperty("trend");
      expect(["up", "down", "stable"]).toContain(result.trend);
    });

    it("should calculate TVL trend", async () => {
      const result = await analyticsService.calculateTrend("tvl");

      expect(result.metric).toBe("tvl");
      expect(typeof result.current).toBe("number");
      expect(typeof result.previous).toBe("number");
    });

    it("should calculate volume trend with filters", async () => {
      const result = await analyticsService.calculateTrend("volume", "USDC", "Circle USDC");

      expect(result.metric).toBe("volume");
      expect(result).toHaveProperty("changePercent");
    });

    it("should throw error for unknown metric", async () => {
      await expect(
        analyticsService.calculateTrend("unknown_metric")
      ).rejects.toThrow("Unknown metric: unknown_metric");
    });

    it("should throw error when symbol required but not provided", async () => {
      await expect(
        analyticsService.calculateTrend("health_score")
      ).rejects.toThrow("Symbol required for health_score metric");
    });
  });

  describe("getTopPerformers", () => {
    it("should return top performing assets by health", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue("OK");

      const result = await analyticsService.getTopPerformers("assets", "health", 5);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it("should return top performing bridges by TVL", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue("OK");

      const result = await analyticsService.getTopPerformers("bridges", "tvl", 10);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("should cache top performers", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue("OK");

      await analyticsService.getTopPerformers("assets", "volume", 5);

      expect(redis.setex).toHaveBeenCalledWith(
        "analytics:top:assets:volume:5",
        300,
        expect.any(String)
      );
    });
  });

  describe("invalidateCache", () => {
    it("should invalidate all analytics cache when no pattern provided", async () => {
      vi.mocked(redis.keys).mockResolvedValue(["analytics:key1", "analytics:key2"]);
      vi.mocked(redis.del).mockResolvedValue(2);

      await analyticsService.invalidateCache();

      expect(redis.keys).toHaveBeenCalledWith("analytics:*");
      expect(redis.del).toHaveBeenCalledWith("analytics:key1", "analytics:key2");
    });

    it("should invalidate cache matching pattern", async () => {
      vi.mocked(redis.keys).mockResolvedValue(["analytics:protocol:stats"]);
      vi.mocked(redis.del).mockResolvedValue(1);

      await analyticsService.invalidateCache("protocol");

      expect(redis.keys).toHaveBeenCalledWith("analytics:protocol*");
      expect(redis.del).toHaveBeenCalledWith("analytics:protocol:stats");
    });

    it("should handle empty cache gracefully", async () => {
      vi.mocked(redis.keys).mockResolvedValue([]);

      await analyticsService.invalidateCache();

      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe("getHistoricalComparison", () => {
    it("should fetch historical health score data", async () => {
      const result = await analyticsService.getHistoricalComparison(
        "health_score",
        "USDC",
        7
      );

      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0]).toHaveProperty("date");
        expect(result[0]).toHaveProperty("value");
      }
    });

    it("should fetch historical volume data", async () => {
      const result = await analyticsService.getHistoricalComparison("volume", "USDC", 30);

      expect(Array.isArray(result)).toBe(true);
    });

    it("should fetch historical liquidity data", async () => {
      const result = await analyticsService.getHistoricalComparison("liquidity", "USDC", 14);

      expect(Array.isArray(result)).toBe(true);
    });

    it("should throw error for unknown metric", async () => {
      await expect(
        analyticsService.getHistoricalComparison("unknown", "USDC", 7)
      ).rejects.toThrow("Unknown metric: unknown");
    });

    it("should throw error when symbol required but not provided", async () => {
      await expect(
        analyticsService.getHistoricalComparison("health_score", undefined, 7)
      ).rejects.toThrow("Symbol required for health_score metric");
    });
  });

  describe("executeCustomMetric", () => {
    it("should execute custom metric query", async () => {
      const customMetric = {
        id: "test-metric",
        name: "Test Metric",
        description: "A test metric",
        query: "SELECT 1 as value",
        parameters: {},
        cacheKey: "test-metric",
        cacheTTL: 300,
      };

      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(redis.setex).mockResolvedValue("OK");

      const result = await analyticsService.executeCustomMetric(customMetric);

      expect(result).toBeDefined();
      expect(redis.setex).toHaveBeenCalledWith(
        "analytics:custom:test-metric",
        300,
        expect.any(String)
      );
    });

    it("should return cached custom metric result", async () => {
      const cachedResult = [{ value: 42 }];
      const customMetric = {
        id: "test-metric",
        name: "Test Metric",
        description: "A test metric",
        query: "SELECT 1 as value",
        parameters: {},
        cacheKey: "test-metric",
        cacheTTL: 300,
      };

      vi.mocked(redis.get).mockResolvedValue(JSON.stringify(cachedResult));

      const result = await analyticsService.executeCustomMetric(customMetric);

      expect(result).toEqual(cachedResult);
      expect(redis.get).toHaveBeenCalledWith("analytics:custom:test-metric");
    });
  });
});
