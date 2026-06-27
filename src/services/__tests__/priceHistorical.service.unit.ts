import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetTimeBucketed = vi.fn();

vi.mock("../../database/models/price.model.js", () => ({
  PriceModel: vi.fn().mockImplementation(() => ({
    getTimeBucketed: mockGetTimeBucketed,
  })),
}));

// Stub out heavy dependencies that PriceService transitively imports
vi.mock("../../utils/stellar.js", () => ({
  getOrderBook: vi.fn(),
  getLiquidityPools: vi.fn(),
  HorizonTimeoutError: class HorizonTimeoutError extends Error {},
  HorizonClientError: class HorizonClientError extends Error {},
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/cache.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({ get: vi.fn(), set: vi.fn() })),
}));

vi.mock("../sources/circle.source.js", () => ({
  CircleSource: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../../config/index.js", () => ({
  config: { PRICE_DEVIATION_THRESHOLD: 0.02 },
  SUPPORTED_ASSETS: [{ code: "USDC", issuer: "GA5Z" }],
}));

import { PriceService } from "../price.service.js";

describe("PriceService.getHistoricalPrices", () => {
  let svc: PriceService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new PriceService();
  });

  it("queries with 5-minute bucket for 1h interval", async () => {
    mockGetTimeBucketed.mockResolvedValue([]);
    await svc.getHistoricalPrices("USDC", "1h");
    expect(mockGetTimeBucketed).toHaveBeenCalledWith("USDC", "5 minutes", expect.any(Date));
    const startArg: Date = mockGetTimeBucketed.mock.calls[0][2];
    expect(Date.now() - startArg.getTime()).toBeCloseTo(60 * 60 * 1000, -3);
  });

  it("queries with 1-hour bucket for 1d interval", async () => {
    mockGetTimeBucketed.mockResolvedValue([]);
    await svc.getHistoricalPrices("USDC", "1d");
    expect(mockGetTimeBucketed).toHaveBeenCalledWith("USDC", "1 hour", expect.any(Date));
  });

  it("queries with 6-hour bucket for 7d interval", async () => {
    mockGetTimeBucketed.mockResolvedValue([]);
    await svc.getHistoricalPrices("USDC", "7d");
    expect(mockGetTimeBucketed).toHaveBeenCalledWith("USDC", "6 hours", expect.any(Date));
  });

  it("queries with 1-day bucket for 30d interval", async () => {
    mockGetTimeBucketed.mockResolvedValue([]);
    await svc.getHistoricalPrices("USDC", "30d");
    expect(mockGetTimeBucketed).toHaveBeenCalledWith("USDC", "1 day", expect.any(Date));
  });

  it("maps rows to { timestamp, price } shape", async () => {
    const bucket = new Date("2024-01-01T00:00:00Z");
    mockGetTimeBucketed.mockResolvedValue([{ bucket, avg_price: "1.0002" }]);

    const result = await svc.getHistoricalPrices("USDC", "1d");

    expect(result).toEqual([{ timestamp: bucket.toISOString(), price: 1.0002 }]);
  });

  it("returns empty array when no rows found", async () => {
    mockGetTimeBucketed.mockResolvedValue([]);
    const result = await svc.getHistoricalPrices("USDC", "1h");
    expect(result).toEqual([]);
  });

  it("uppercases the symbol before querying", async () => {
    mockGetTimeBucketed.mockResolvedValue([]);
    await svc.getHistoricalPrices("usdc", "1h");
    expect(mockGetTimeBucketed).toHaveBeenCalledWith("USDC", expect.any(String), expect.any(Date));
  });
});
