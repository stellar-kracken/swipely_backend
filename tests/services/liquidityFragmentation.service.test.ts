import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { LiquidityFragmentationService } from "../../src/services/liquidityFragmentation.service.js";
import { CacheService } from "../../src/utils/cache.js";

const createQueryBuilder = (rows: any[] = []) => {
  const builder: any = {
    select: vi.fn(() => builder),
    where: vi.fn(() => builder),
    whereIn: vi.fn(() => builder),
    groupBy: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    having: vi.fn(() => builder),
    then: (resolve: (value: any) => any) => resolve(rows),
  };
  return builder;
};

const mockKnex = vi.hoisted(() => {
  const knex: any = vi.fn(() => undefined);
  knex.raw = vi.fn((sql: string) => sql);
  return knex;
});

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockKnex,
}));

// Bypass Redis: getOrSet simply runs the fetcher.
vi.mock("../../src/utils/cache.js", () => ({
  CacheService: {
    getOrSet: vi.fn(),
    invalidateByTag: vi.fn(),
    invalidatePattern: vi.fn(),
    generateKey: vi.fn((namespace, id) => `cache:${namespace}:${id}`),
  },
  CacheTTL: { ANALYTICS: 300, PRICES: 60, METADATA: 3600, LONG_LIVED: 86400 },
}));

vi.mock("../../src/utils/redis.js", () => ({
  redis: { expire: vi.fn(), del: vi.fn(), keys: vi.fn().mockResolvedValue([]) },
}));

describe("LiquidityFragmentationService", () => {
  let service: LiquidityFragmentationService;

  beforeEach(() => {
    service = new LiquidityFragmentationService();
    vi.clearAllMocks();
    mockKnex.mockImplementation(() => createQueryBuilder([]));
    vi.mocked(CacheService.getOrSet).mockImplementation(
      async (_key: string, fetcher: () => any) => fetcher(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Pure scoring math (exercised through the private methods) ──────────────

  describe("fragmentation scoring math", () => {
    const calc = () => service as any;

    it("computes the Herfindahl index as the sum of squared shares", () => {
      expect(calc().calculateHerfindahlIndex([0.5, 0.5])).toBeCloseTo(0.5);
      expect(calc().calculateHerfindahlIndex([1])).toBeCloseTo(1);
    });

    it("returns a Gini coefficient of 0 for perfectly even liquidity", () => {
      expect(calc().calculateGiniCoefficient([5, 5, 5])).toBeCloseTo(0);
    });

    it("returns 0 Gini for an empty distribution", () => {
      expect(calc().calculateGiniCoefficient([])).toBe(0);
    });

    it("returns a positive Gini for skewed liquidity", () => {
      expect(calc().calculateGiniCoefficient([0, 10])).toBeGreaterThan(0);
    });

    it("blends Herfindahl, Gini and DEX diversity into a rounded score", () => {
      // herfindahl 0.5 -> 50, gini 0.3 -> 30, diversity 2/5 -> 40
      // 50*0.4 + 30*0.4 + 40*0.2 = 40
      expect(calc().calculateFragmentationScore(0.5, 0.3, 2)).toBe(40);
    });

    it("treats zero liquidity as maximum price impact", () => {
      expect(calc().estimatePriceImpact(100, 0)).toBe(1);
    });

    it("caps price impact at 0.99", () => {
      expect(calc().estimatePriceImpact(1_000_000, 1)).toBe(0.99);
    });

    it("rewards balanced, deep liquidity with higher confidence", () => {
      const balanced = calc().calculateConfidence(100_000, 100_000);
      const imbalanced = calc().calculateConfidence(1_000, 100_000);
      expect(balanced).toBeGreaterThan(imbalanced);
      expect(calc().calculateConfidence(0, 0)).toBe(0);
    });
  });

  // ── getFragmentationMetrics ────────────────────────────────────────────────

  describe("getFragmentationMetrics", () => {
    it("returns null when there is no liquidity data", async () => {
      mockKnex.mockImplementation(() => createQueryBuilder([]));
      expect(await service.getFragmentationMetrics("USDC")).toBeNull();
    });

    it("returns null when total liquidity is below the threshold", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([{ dex: "SDEX", avg_liquidity: "50" }]),
      );
      expect(await service.getFragmentationMetrics("USDC")).toBeNull();
    });

    it("computes metrics across multiple DEXes", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          { dex: "SDEX", avg_liquidity: "6000" },
          { dex: "Phoenix", avg_liquidity: "4000" },
        ]),
      );

      const metrics = await service.getFragmentationMetrics("USDC");
      expect(metrics).not.toBeNull();
      expect(metrics!.symbol).toBe("USDC");
      expect(metrics!.totalLiquidity).toBe(10000);
      expect(metrics!.dexCount).toBe(2);
      expect(metrics!.concentrationRatio).toBeCloseTo(0.6);
      expect(typeof metrics!.fragmentationScore).toBe("number");
      expect(metrics!.herfindahlIndex).toBeGreaterThan(0);
    });

    it("uses the cache layer", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([{ dex: "SDEX", avg_liquidity: "6000" }]),
      );
      await service.getFragmentationMetrics("USDC");
      expect(CacheService.getOrSet).toHaveBeenCalledWith(
        "cache:fragmentation:metrics:USDC",
        expect.any(Function),
        expect.objectContaining({ tags: ["fragmentation"] }),
      );
    });
  });

  // ── getDexLiquidityDistribution ────────────────────────────────────────────

  describe("getDexLiquidityDistribution", () => {
    it("returns ranked shares that reflect each DEX's portion of liquidity", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          { dex: "SDEX", avg_liquidity: "6000" },
          { dex: "Phoenix", avg_liquidity: "4000" },
        ]),
      );

      const distribution = await service.getDexLiquidityDistribution("USDC");
      expect(distribution).toHaveLength(2);
      expect(distribution[0]).toMatchObject({ dex: "SDEX", liquidity: 6000, rank: 1 });
      expect(distribution[0].share).toBeCloseTo(60);
      expect(distribution[1]).toMatchObject({ dex: "Phoenix", liquidity: 4000, rank: 2 });
      expect(distribution[1].share).toBeCloseTo(40);
    });

    it("returns an empty distribution when there is no data", async () => {
      mockKnex.mockImplementation(() => createQueryBuilder([]));
      expect(await service.getDexLiquidityDistribution("USDC")).toEqual([]);
    });
  });

  // ── detectArbitrageOpportunities ───────────────────────────────────────────

  describe("detectArbitrageOpportunities", () => {
    it("returns no opportunities when a pair has fewer than two DEXes", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          { dex: "SDEX", bid_depth: "100", ask_depth: "100", tvl_usd: "10000" },
        ]),
      );
      const opportunities = await service.detectArbitrageOpportunities(["USDC/XLM"]);
      expect(opportunities).toEqual([]);
    });
  });
});
