import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PriceService, PriceFetchError } from "../../src/services/price.service.js";
import { CacheService } from "../../src/utils/cache.js";
import {
  getOrderBook,
  getLiquidityPools,
  HorizonTimeoutError,
  HorizonClientError,
} from "../../src/utils/stellar.js";

vi.mock("../../src/utils/cache.js", () => ({
  CacheService: {
    getOrSet: vi.fn(),
    generateKey: vi.fn((ns, key) => `cache:${ns}:${key}`),
  },
  CacheTTL: {
    PRICES: 60,
  },
}));

vi.mock("../../src/services/sources/circle.source.js", () => {
  return {
    CircleSource: class {
      static supports(symbol: string) {
        return symbol === "USDC" || symbol === "EURC";
      }
      async getPriceSourceData(symbol: string) {
        if (symbol === "USDC")
          return { price: 1.0, volume: 1000000, name: "Circle" };
        if (symbol === "EURC")
          return { price: 1.05, volume: 500000, name: "Circle" };
        throw new Error("Unsupported symbol in mocked Circle API");
      }
    },
  };
});

vi.mock("../../src/utils/stellar.js", () => ({
  getOrderBook: vi.fn(),
  getLiquidityPools: vi.fn(),
  HorizonTimeoutError: class HorizonTimeoutError extends Error {
    constructor(m = "Horizon API request timed out") {
      super(m);
      this.name = "HorizonTimeoutError";
    }
  },
  HorizonClientError: class HorizonClientError extends Error {
    constructor(m: string, public e: any) {
      super(m);
      this.name = "HorizonClientError";
    }
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    REDIS_CACHE_TTL_SEC: 30,
    REDIS_PRICE_CACHE_PREFIX: "price:aggregated",
    PRICE_DEVIATION_THRESHOLD: 0.02,
    LOG_LEVEL: "info",
  },
  SUPPORTED_ASSETS: [
    { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
    { code: "PYUSD", issuer: "GBHZAE5IQTOPQZ66TFWZYIYCHQ6T3GMWHDKFEXAKYWJ2BHLZQ227KRYE" },
    { code: "EURC", issuer: "GDQOE23CFSUMSVZZ4YRVXGW7PCFNIAHLMRAHDE4Z32DIBQGH4KZZK2KZ" },
    { code: "XLM", issuer: "native" },
    { code: "FOBXX", issuer: "GBX7VUT2UTUKO2H76J26D7QYWNFW6C2NYN6K74Y3K43HGBXYZ" },
  ],
}));

describe("PriceService", () => {
  let priceService: PriceService;

  beforeEach(() => {
    priceService = new PriceService();
    vi.resetAllMocks();

    vi.mocked(CacheService.generateKey).mockImplementation(
      (ns, key) => `cache:${ns}:${key}`
    );
    vi.mocked(CacheService.getOrSet).mockImplementation(async (_key, fetcher) => {
      return fetcher();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchSDEXPrice", () => {
    it("returns mock price 1 for USDC", async () => {
      const result = await priceService.fetchSDEXPrice("USDC");
      expect(result).toEqual({ price: 1, volume: 1000000 });
      expect(getOrderBook).not.toHaveBeenCalled();
    });

    it("calculates VWAP from orderbook for other assets", async () => {
      vi.mocked(getOrderBook).mockResolvedValue({
        bids: [
          { price: "0.1", amount: "100" },
          { price: "0.09", amount: "200" },
        ],
        asks: [
          { price: "0.11", amount: "150" },
          { price: "0.12", amount: "50" },
        ],
        base: {} as any,
        counter: {} as any,
      } as any);

      const result = await priceService.fetchSDEXPrice("XLM");

      expect(result.price).toBeCloseTo(0.101);
      expect(result.volume).toBe(500);
      expect(getOrderBook).toHaveBeenCalledWith(
        "XLM",
        "native",
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
    });

    it("handles timeout correctly by rethrowing HorizonTimeoutError", async () => {
      vi.mocked(getOrderBook).mockRejectedValue(new HorizonTimeoutError());
      await expect(priceService.fetchSDEXPrice("XLM")).rejects.toThrow(
        HorizonTimeoutError
      );
    });

    it("throws PriceFetchError for unsupported assets", async () => {
      await expect(priceService.fetchSDEXPrice("INVALID")).rejects.toThrow(
        PriceFetchError
      );
    });

    it("throws PriceFetchError when orderbook is empty", async () => {
      vi.mocked(getOrderBook).mockResolvedValue({
        bids: [],
        asks: [],
        base: {} as any,
        counter: {} as any,
      } as any);
      await expect(priceService.fetchSDEXPrice("XLM")).rejects.toThrow(
        PriceFetchError
      );
    });

    it("handles generic errors by wrapping in PriceFetchError", async () => {
      vi.mocked(getOrderBook).mockRejectedValue(new Error("Network failed"));
      await expect(priceService.fetchSDEXPrice("XLM")).rejects.toThrow(
        PriceFetchError
      );
    });
  });

  describe("fetchAMMPrice", () => {
    it("returns pure 1 for USDC", async () => {
      const result = await priceService.fetchAMMPrice("USDC");
      expect(result).toEqual({ price: 1, volume: 1000000 });
    });

    it("calculates price from AMM reserves", async () => {
      vi.mocked(getLiquidityPools).mockResolvedValue({
        records: [
          {
            reserves: [
              { asset: "native", amount: "1000" },
              {
                asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
                amount: "100",
              },
            ],
          },
        ],
      } as any);

      const result = await priceService.fetchAMMPrice("XLM");
      expect(result.price).toBeCloseTo(0.1);
      expect(result.volume).toBe(200);
    });

    it("throws PriceFetchError for unsupported assets", async () => {
      await expect(priceService.fetchAMMPrice("INVALID")).rejects.toThrow(
        PriceFetchError
      );
    });

    it("rethrows HorizonClientError", async () => {
      vi.mocked(getLiquidityPools).mockRejectedValue(
        new HorizonClientError("horizon down", new Error("horizon down"))
      );
      await expect(priceService.fetchAMMPrice("XLM")).rejects.toThrow(
        HorizonClientError
      );
    });

    it("throws PriceFetchError when pools are missing", async () => {
      vi.mocked(getLiquidityPools).mockResolvedValue({ records: [] } as any);
      await expect(priceService.fetchAMMPrice("XLM")).rejects.toThrow(
        PriceFetchError
      );
    });
  });

  describe("calculateVWAP", () => {
    it("computes VWAP from multiple sources", () => {
      const sources = [
        { price: 0.1, volume: 100, name: "SDEX" },
        { price: 0.12, volume: 200, name: "AMM" },
      ];
      const result = priceService.calculateVWAP(sources);
      expect(result.vwap).toBeCloseTo(0.113333);
      expect(result.validSources).toHaveLength(2);
    });

    it("computes VWAP from a single source if one is missing volume", () => {
      const sources = [
        { price: 0.1, volume: 100, name: "SDEX" },
        { price: 0.12, volume: 0, name: "AMM" },
      ];
      const result = priceService.calculateVWAP(sources);
      expect(result.vwap).toBeCloseTo(0.1);
      expect(result.validSources).toHaveLength(1);
    });

    it("throws if all sources lack volume", () => {
      const sources = [
        { price: 0.1, volume: 0, name: "SDEX" },
        { price: NaN, volume: 100, name: "AMM" },
      ];
      expect(() => priceService.calculateVWAP(sources)).toThrow(
        "No valid sources"
      );
    });
  });

  describe("getAggregatedPrice", () => {
    beforeEach(() => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockResolvedValue({
        price: 0.1,
        volume: 100,
      });
      vi.spyOn(priceService, "fetchAMMPrice").mockResolvedValue({
        price: 0.12,
        volume: 200,
      });
    });

    it("returns cached result when CacheService returns stored aggregate", async () => {
      vi.mocked(CacheService.getOrSet).mockResolvedValue({
        symbol: "XLM",
        vwap: 999,
        sources: [],
        deviation: 0,
        lastUpdated: new Date().toISOString(),
      });
      const result = await priceService.getAggregatedPrice("XLM");
      expect(result?.vwap).toBe(999);
      expect(priceService.fetchSDEXPrice).not.toHaveBeenCalled();
    });

    it("fetches from SDEX and AMM on cache miss and uses configured TTL", async () => {
      const result = await priceService.getAggregatedPrice("XLM");
      expect(result?.vwap).toBeCloseTo(0.113333);
      expect(result?.deviation).toBeGreaterThan(0);
      expect(priceService.fetchSDEXPrice).toHaveBeenCalledWith("XLM");
      expect(priceService.fetchAMMPrice).toHaveBeenCalledWith("XLM");
      expect(CacheService.getOrSet).toHaveBeenCalledWith(
        "cache:price:aggregated:XLM",
        expect.any(Function),
        expect.objectContaining({ ttl: 30, tags: ["price"] })
      );
    });

    it("gracefully calculates from SDEX if AMM fails", async () => {
      vi.spyOn(priceService, "fetchAMMPrice").mockRejectedValue(
        new Error("AMM Down")
      );
      const result = await priceService.getAggregatedPrice("XLM");
      expect(result?.vwap).toBeCloseTo(0.1);
      expect(result?.sources).toHaveLength(1);
    });

    it("gracefully calculates from AMM if SDEX fails", async () => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockRejectedValue(
        new Error("SDEX Down")
      );
      const result = await priceService.getAggregatedPrice("XLM");
      expect(result?.vwap).toBeCloseTo(0.12);
      expect(result?.sources).toHaveLength(1);
    });

    it("throws if both Stellar sources fail", async () => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockRejectedValue(
        new HorizonTimeoutError("First error")
      );
      vi.spyOn(priceService, "fetchAMMPrice").mockRejectedValue(
        new Error("Second error")
      );
      await expect(priceService.getAggregatedPrice("XLM")).rejects.toThrow(
        "First error"
      );
    });

    it("works for each of the 5 assets", async () => {
      const assets = ["USDC", "PYUSD", "EURC", "XLM", "FOBXX"];
      for (const asset of assets) {
        const result = await priceService.getAggregatedPrice(asset);
        expect(result?.symbol).toBe(asset);
      }
    });

    it("normalizes symbol casing", async () => {
      const result = await priceService.getAggregatedPrice("xlm");
      expect(result?.symbol).toBe("XLM");
      expect(priceService.fetchSDEXPrice).toHaveBeenCalledWith("XLM");
    });
  });

  describe("getPriceFromSource", () => {
    it("returns SDEX source price", async () => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockResolvedValue({
        price: 0.1,
        volume: 100,
      });
      const source = await priceService.getPriceFromSource("XLM", "sdex");
      expect(source?.source).toBe("SDEX");
      expect(source?.price).toBe(0.1);
    });

    it("returns AMM source price", async () => {
      vi.spyOn(priceService, "fetchAMMPrice").mockResolvedValue({
        price: 0.12,
        volume: 200,
      });
      const source = await priceService.getPriceFromSource("XLM", "amm");
      expect(source?.source).toBe("AMM");
      expect(source?.price).toBe(0.12);
    });

    it("returns Circle source price for USDC", async () => {
      const source = await priceService.getPriceFromSource("USDC", "circle");
      expect(source?.source).toBe("Circle");
      expect(source?.price).toBe(1.0);
    });

    it("returns null for unknown source", async () => {
      const source = await priceService.getPriceFromSource("XLM", "coinbase");
      expect(source).toBeNull();
    });
  });

  describe("checkDeviation", () => {
    it("returns deviated=true when threshold is exceeded", async () => {
      vi.spyOn(priceService, "getAggregatedPrice").mockResolvedValue({
        symbol: "XLM",
        vwap: 1,
        sources: [
          { source: "SDEX", price: 1, timestamp: new Date().toISOString() },
          { source: "AMM", price: 1.1, timestamp: new Date().toISOString() },
        ],
        deviation: 0.1,
        lastUpdated: new Date().toISOString(),
      });
      const result = await priceService.checkDeviation("XLM");
      expect(result).toEqual({ deviated: true, percentage: 0.1 });
    });

    it("returns deviated=false for null aggregated price", async () => {
      vi.spyOn(priceService, "getAggregatedPrice").mockResolvedValue(null);
      const result = await priceService.checkDeviation("XLM");
      expect(result).toEqual({ deviated: false, percentage: 0 });
    });
  });
});
