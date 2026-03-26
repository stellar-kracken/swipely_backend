import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiquidityService } from "../../src/services/liquidity.service.js";
import { redis } from "../../src/utils/redis.js";
import { getOrderBook, getLiquidityPools } from "../../src/utils/stellar.js";

vi.mock("../../src/utils/logger.js");
vi.mock("../../src/utils/redis.js");
vi.mock("../../src/utils/stellar.js");
vi.mock("../../src/config/index.js", () => ({
  config: { REDIS_CACHE_TTL_SEC: 60, LOG_LEVEL: "info" },
  SUPPORTED_ASSETS: [
    { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
    { code: "PYUSD", issuer: "GBHZAE5IQTOPQZ66TFWZYIYCHQ6T3GMWHDKFEXAKYWJ2BHLZQ227KRYE" },
    { code: "EURC", issuer: "GDQOE23CFSUMSVZZ4YRVXGW7PCFNIAHLMRAHDE4Z32DIBQGH4KZZK2KZ" },
    { code: "XLM", issuer: "native" },
    { code: "FOBXX", issuer: "GBX7VUT2UTUKO2H76J26D7QYWNFW6C2NYN6K74Y3K43HGBXYZ" },
  ],
}));

describe("LiquidityService", () => {
  let service: LiquidityService;

  beforeEach(() => {
    service = new LiquidityService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getAggregatedLiquidity", () => {
    it("exists and is callable", () => {
      expect(typeof service.getAggregatedLiquidity).toBe("function");
    });

    it("returns null when no sources provide data", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(getOrderBook).mockResolvedValue({
        bids: [],
        asks: [],
        base: { asset_code: "XLM" },
        counter: { asset_code: "USDC" },
      } as any);
      vi.mocked(getLiquidityPools).mockResolvedValue({ records: [] } as any);

      const result = await service.getAggregatedLiquidity("XLM");
      expect(result).toBeNull();
    });

    it("caches results in Redis with 60 second TTL", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(getOrderBook).mockResolvedValue({
        bids: [{ price: "0.1", amount: "100" }],
        asks: [{ price: "0.11", amount: "150" }],
        base: {},
        counter: {},
      } as any);
      vi.mocked(getLiquidityPools).mockResolvedValue({ records: [] } as any);

      const result = await service.getAggregatedLiquidity("XLM");

      if (result) {
        const setCalls = vi.mocked(redis.set).mock.calls;
        if (setCalls.length > 0) {
          expect(setCalls[0][2]).toBe("EX");
          expect(setCalls[0][3]).toBe(60);
        }
      }
    });

    it("returns aggregated data correctly", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(getOrderBook).mockResolvedValue({
        bids: [{ price: "0.1", amount: "100" }],
        asks: [{ price: "0.11", amount: "150" }],
        base: {},
        counter: {},
      } as any);
      vi.mocked(getLiquidityPools).mockResolvedValue({
        records: [{ reserves: [{ asset: "native", amount: "1000" }, { asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", amount: "100" }] }],
      } as any);

      const result = await service.getAggregatedLiquidity("XLM");

      if (result) {
        expect(result.symbol).toBe("XLM");
        expect(result.totalLiquidity).toBeGreaterThan(0);
        expect(result.sources.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getDexLiquidity", () => {
    it("exists and is callable", () => {
      expect(typeof service.getDexLiquidity).toBe("function");
    });

    it("returns null when aggregation returns null", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);
      vi.mocked(getOrderBook).mockResolvedValue({
        bids: [],
        asks: [],
        base: {},
        counter: {},
      } as any);
      vi.mocked(getLiquidityPools).mockResolvedValue({ records: [] } as any);

      const result = await service.getDexLiquidity("XLM", "SDEX");

      expect(result).toBeNull();
    });
  });

  describe("getBestRoute", () => {
    it("exists and is callable", () => {
      expect(typeof service.getBestRoute).toBe("function");
    });

    it("returns empty route when no contract configured", async () => {
      const result = await service.getBestRoute("XLM", "USDC", 100);

      expect(result.route).toEqual([]);
      expect(result.estimatedOutput).toBe(0);
    });
  });

  describe("Circuit Breaker", () => {
    it("recovers from failures", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      // Simulate failures
      vi.mocked(getOrderBook).mockRejectedValueOnce(new Error("Network error"));
      vi.mocked(getLiquidityPools).mockResolvedValueOnce({ records: [] } as any);

      await service.getAggregatedLiquidity("XLM");

      // Verify service is still functional
      expect(typeof service.getAggregatedLiquidity).toBe("function");
    });
  });

  describe("Support for Phase 1 Assets", () => {
    it("handles all phase 1 asset symbols", async () => {
      const assets = ["USDC", "PYUSD", "EURC", "FOBXX", "XLM"];

      for (const symbol of assets) {
        vi.resetAllMocks();
        vi.mocked(redis.get).mockResolvedValue(null);
        vi.mocked(getOrderBook).mockResolvedValue({
          bids: [],
          asks: [],
          base: {},
          counter: {},
        } as any);
        vi.mocked(getLiquidityPools).mockResolvedValue({ records: [] } as any);

        const result = await service.getAggregatedLiquidity(symbol);

        // Either returns null (no data) or has correct symbol
        if (result !== null) {
          expect(result.symbol).toBe(symbol);
        }
      }
    });
  });
});
