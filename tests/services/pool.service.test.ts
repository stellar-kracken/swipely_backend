import { beforeEach, describe, expect, it, vi } from "vitest";
import { PoolService, type LiquidityPool } from "../../src/services/pool.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {},
}));

const dbMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => dbMock,
}));

function makeDbPool(overrides: Record<string, unknown> = {}) {
  return {
    id: "pool-1",
    asset_a: "USDC",
    asset_b: "XLM",
    dex: "StellarX",
    contract_address: "contract-1",
    total_liquidity: "1000000",
    reserve_a: "500000",
    reserve_b: "2000000",
    fee: "0.003",
    apr: "5.2",
    volume_24h: "100000",
    health_score: 75,
    last_updated: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    pool_id: "pool-1",
    type: "deposit",
    amount_a: "120000",
    amount_b: "30000",
    user: "GUSER",
    timestamp: new Date("2026-01-02T00:00:00.000Z"),
    tx_hash: "tx-1",
    ...overrides,
  };
}

function setupPoolMetricDb(poolRow: ReturnType<typeof makeDbPool> | null, volumeRow = { totalA: "700", totalB: "300" }) {
  dbMock.mockImplementation((table: string) => {
    if (table === "liquidity_pools") {
      const builder = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(poolRow),
      };
      return builder;
    }

    const builder = {
      where: vi.fn().mockReturnThis(),
      sum: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(volumeRow),
    };
    return builder;
  });
}

describe("PoolService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates pools across supported AMMs sorted by total liquidity", async () => {
    const service = new PoolService();

    const pools = await service.getAllPools();

    expect(pools.map((pool) => pool.dex)).toEqual([
      "StellarX",
      "Phoenix",
      "LumenSwap",
      "Soroswap",
      "SDEX",
    ]);
    expect(pools.map((pool) => pool.totalLiquidity)).toEqual([1_000_000, 800_000, 600_000, 400_000, 300_000]);
  });

  it("filters asset pairs in either asset order", async () => {
    const service = new PoolService();

    const forward = await service.getPoolsForPair("USDC", "XLM");
    const reverse = await service.getPoolsForPair("XLM", "USDC");

    expect(forward).toHaveLength(5);
    expect(reverse.map((pool) => pool.id)).toEqual(forward.map((pool) => pool.id));
    expect(await service.getPoolsForPair("USDC", "EURC")).toEqual([]);
  });

  it("compares multi-AMM pools and calculates aggregate liquidity and volume", async () => {
    const service = new PoolService();

    const comparison = await service.comparePools("USDC", "XLM");

    expect(comparison?.bestTVL.dex).toBe("StellarX");
    expect(comparison?.bestAPR.dex).toBe("Soroswap");
    expect(comparison?.bestHealth.dex).toBe("StellarX");
    expect(comparison?.aggregatedTVL).toBe(3_100_000);
    expect(comparison?.aggregatedVolume).toBe(310_000);
  });

  it("returns null comparison when a pair has no pools", async () => {
    const service = new PoolService();

    await expect(service.comparePools("USDC", "EURC")).resolves.toBeNull();
  });

  it("calculates depth, utilization, volume, and health metrics for a pool", async () => {
    setupPoolMetricDb(makeDbPool());
    const service = new PoolService();

    const metrics = await service.getPoolMetrics("pool-1");

    expect(metrics).toEqual({
      poolId: "pool-1",
      tvl: 1_000_000,
      volume24h: 100_000,
      volume7d: 1_000,
      apr: 5.2,
      fee: 0.003,
      utilization: 0.1,
      healthScore: 90,
      liquidityDepth: {
        depth0_1: 10_000,
        depth0_5: 50_000,
        depth1: 100_000,
        depth5: 500_000,
      },
    });
  });

  it("returns null metrics for an unknown pool", async () => {
    setupPoolMetricDb(null);
    const service = new PoolService();

    await expect(service.getPoolMetrics("missing")).resolves.toBeNull();
  });

  it("detects large liquidity events relative to pool TVL", async () => {
    dbMock.mockImplementation((table: string) => {
      if (table === "pool_events") {
        return {
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue([
            makeEvent({ id: "large", amount_a: "110000", amount_b: "10000" }),
            makeEvent({ id: "small", amount_a: "1000", amount_b: "1000" }),
          ]),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const service = new PoolService();
    vi.spyOn(service, "getAllPools").mockResolvedValue([
      {
        id: "pool-1",
        assetA: "USDC",
        assetB: "XLM",
        dex: "StellarX",
        totalLiquidity: 1_000_000,
        reserveA: 500_000,
        reserveB: 2_000_000,
        fee: 0.003,
        apr: 5.2,
        volume24h: 100_000,
        healthScore: 75,
        lastUpdated: new Date(),
      } satisfies LiquidityPool,
    ]);

    const events = await service.detectLargeLiquidityEvents(0.1);

    expect(events).toEqual([expect.objectContaining({ id: "large", amountA: 110_000, amountB: 10_000 })]);
  });
});
