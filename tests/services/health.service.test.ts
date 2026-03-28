import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthService } from "../../src/services/health.service.js";
import { ScoreCalculator } from "../../src/utils/scoreCalculator.js";

// Hoisted mocks for granular control
const mocks = vi.hoisted(() => ({
  price: {
    getAggregatedPrice: vi.fn().mockResolvedValue({ deviation: 0.01 }),
  },
  bridge: {
    getAllBridgeStatuses: vi.fn().mockResolvedValue({ bridges: [{ name: "USDC", status: "healthy" }] }),
    verifySupply: vi.fn().mockResolvedValue({ mismatchPercentage: 0.05 }),
  },
  liquidity: {
    getAggregatedLiquidity: vi.fn().mockResolvedValue({
      totalLiquidity: 1000000,
      sources: [{ bidDepth: 500000, askDepth: 500000 }]
    }),
  },
  model: {
    insert: vi.fn().mockResolvedValue(undefined),
    getLatest: vi.fn().mockResolvedValue({ overall_score: 90 }),
    getTimeBucketed: vi.fn().mockResolvedValue([]),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
}));

vi.mock("../../src/utils/logger.js", () => ({ logger: mocks.logger }));
vi.mock("../../src/services/price.service.js", () => ({ PriceService: vi.fn().mockImplementation(() => mocks.price) }));
vi.mock("../../src/services/bridge.service.js", () => ({ BridgeService: vi.fn().mockImplementation(() => mocks.bridge) }));
vi.mock("../../src/services/liquidity.service.js", () => ({ LiquidityService: vi.fn().mockImplementation(() => mocks.liquidity) }));
vi.mock("../../src/database/models/healthScore.model.js", () => ({ HealthScoreModel: vi.fn().mockImplementation(() => mocks.model) }));

describe("HealthService", () => {
  let healthService: HealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    healthService = new HealthService();
  });

  describe("getHealthScore", () => {
    it("should calculate a healthy score for USDC with good metrics", async () => {
      const result = await healthService.getHealthScore("USDC");
      
      expect(result).not.toBeNull();
      expect(result?.overallScore).toBeGreaterThan(80);
      expect(result?.factors.liquidityDepth).toBe(100);
      expect(result?.factors.priceStability).toBe(90); // 100 - (0.01 * 1000)
    });

    it("should detect a score drop and log a warning", async () => {
      // Setup: previous score is 100
      mocks.model.getLatest.mockResolvedValue({ overall_score: 100 });
      
      // Set deviation high so score drops significantly
      mocks.price.getAggregatedPrice.mockResolvedValue({ deviation: 0.1 }); // score = 100 - 100 = 0

      await healthService.getHealthScore("USDC");
      
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: "USDC" }),
        "Significant health score drop detected"
      );
    });
  });

  describe("ScoreCalculator", () => {
    it("should calculate correct composite score based on weights", () => {
      const components = {
        liquidityDepth: 100,
        priceStability: 100,
        bridgeUptime: 100,
        reserveBacking: 100,
        volumeTrend: 100
      };
      
      const score = ScoreCalculator.calculateCompositeScore(components);
      expect(score).toBe(100);
    });

    it("should handle low liquidity correctly", () => {
      const score = ScoreCalculator.calculateLiquidityScore(1000, 500, 500);
      expect(score).toBeLessThan(60);
    });
  });
});
