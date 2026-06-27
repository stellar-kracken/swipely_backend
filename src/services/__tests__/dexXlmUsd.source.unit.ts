import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn().mockResolvedValue("OK");

vi.mock("../../utils/redis.js", () => ({
  redis: { get: mockRedisGet, set: mockRedisSet },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/retry.js", () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("../providerAllowlist.service.js", () => ({
  providerAllowlistService: { isAllowed: vi.fn().mockResolvedValue(true) },
}));

// fetchJson is module-internal; we spy on globalThis.fetch instead
const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

// Helper to mock a successful fetch response
function mockFetch(body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => body,
  });
}

// Helper to mock a failed fetch
function mockFetchFail() {
  fetchMock.mockRejectedValueOnce(new Error("network error"));
}

import { DexSource } from "../sources/dex.source.js";

describe("DexSource.fetchXlmUsd", () => {
  let svc: DexSource;
  let fetchXlmUsd: () => Promise<number>;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new DexSource();
    fetchXlmUsd = (svc as any).fetchXlmUsd.bind(svc);
  });

  it("returns cached value when redis cache is warm", async () => {
    mockRedisGet.mockResolvedValueOnce("0.15");
    const price = await fetchXlmUsd();
    expect(price).toBe(0.15);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches from Stellar DEX and caches the result", async () => {
    mockRedisGet.mockResolvedValue(null);
    // Stellar DEX order book: mid-price XLM/USDC = 7.5 → XLM/USD = 1/7.5 ≈ 0.1333
    mockFetch({ bids: [{ price: "7.0" }], asks: [{ price: "8.0" }] });

    const price = await fetchXlmUsd();
    expect(price).toBeCloseTo(1 / 7.5, 5);
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it("falls back to Binance when Stellar DEX fetch fails", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockFetchFail(); // Stellar DEX fails
    mockFetch({ symbol: "XLMUSDT", price: "0.14" }); // Binance succeeds

    const price = await fetchXlmUsd();
    expect(price).toBe(0.14);
  });

  it("returns hardcoded fallback when both sources fail and no stale cache", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockFetchFail(); // Stellar DEX fails
    mockFetchFail(); // Binance fails

    const price = await fetchXlmUsd();
    expect(price).toBe(0.12);
  });

  it("returns stale cache when both live sources fail", async () => {
    mockRedisGet
      .mockResolvedValueOnce(null)       // primary cache miss
      .mockResolvedValueOnce("0.13");    // stale cache hit
    mockFetchFail(); // Stellar DEX fails
    mockFetchFail(); // Binance fails

    const price = await fetchXlmUsd();
    expect(price).toBe(0.13);
  });
});
