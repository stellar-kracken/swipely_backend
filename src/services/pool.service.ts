import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getDatabase } from "../database/connection.js";

export interface LiquidityPool {
  id: string;
  assetA: string;
  assetB: string;
  dex: string;
  contractAddress?: string;
  totalLiquidity: number;
  reserveA: number;
  reserveB: number;
  fee: number;
  apr: number;
  volume24h: number;
  healthScore: number;
  lastUpdated: Date;
}

export interface PoolEvent {
  id: string;
  poolId: string;
  type: "deposit" | "withdraw" | "swap";
  amountA: number;
  amountB: number;
  user: string;
  timestamp: Date;
  txHash: string;
}

export interface PoolMetrics {
  poolId: string;
  tvl: number;
  volume24h: number;
  volume7d: number;
  apr: number;
  fee: number;
  utilization: number;
  healthScore: number;
  liquidityDepth: {
    depth0_1: number;
    depth0_5: number;
    depth1: number;
    depth5: number;
  };
}

export interface PoolComparison {
  pools: LiquidityPool[];
  bestTVL: LiquidityPool;
  bestAPR: LiquidityPool;
  bestHealth: LiquidityPool;
  aggregatedTVL: number;
  aggregatedVolume: number;
}

const SUPPORTED_DEXES = ["StellarX", "Phoenix", "LumenSwap", "Soroswap", "SDEX"] as const;

export class PoolService {
  private db = getDatabase();

  /**
   * Get all liquidity pools across supported DEXes
   */
  async getAllPools(): Promise<LiquidityPool[]> {
    logger.info("Fetching all liquidity pools");
    
    const pools: LiquidityPool[] = [];
    
    for (const dex of SUPPORTED_DEXES) {
      try {
        const dexPools = await this.fetchDEXPools(dex);
        pools.push(...dexPools);
      } catch (error) {
        logger.warn({ dex, error }, `Failed to fetch pools from ${dex}`);
      }
    }

    return pools.sort((a, b) => b.totalLiquidity - a.totalLiquidity);
  }

  /**
   * Get pools for a specific asset pair
   */
  async getPoolsForPair(assetA: string, assetB: string): Promise<LiquidityPool[]> {
    const allPools = await this.getAllPools();
    return allPools.filter(
      pool => 
        (pool.assetA === assetA && pool.assetB === assetB) ||
        (pool.assetA === assetB && pool.assetB === assetA)
    );
  }

  /**
   * Get detailed metrics for a specific pool
   */
  async getPoolMetrics(poolId: string): Promise<PoolMetrics | null> {
    logger.info({ poolId }, "Fetching pool metrics");

    const pool = await this.getPoolById(poolId);
    if (!pool) {
      return null;
    }

    // Calculate liquidity depth
    const liquidityDepth = await this.calculateLiquidityDepth(pool);
    
    // Calculate utilization rate
    const utilization = pool.volume24h / pool.totalLiquidity;

    // Calculate health score
    const healthScore = this.calculatePoolHealthScore(pool, liquidityDepth, utilization);

    return {
      poolId,
      tvl: pool.totalLiquidity,
      volume24h: pool.volume24h,
      volume7d: await this.getVolume7d(poolId),
      apr: pool.apr,
      fee: pool.fee,
      utilization,
      healthScore,
      liquidityDepth,
    };
  }

  /**
   * Compare pools across DEXes for the same pair
   */
  async comparePools(assetA: string, assetB: string): Promise<PoolComparison | null> {
    const pools = await this.getPoolsForPair(assetA, assetB);
    
    if (pools.length === 0) {
      return null;
    }

    const bestTVL = pools.reduce((max, pool) => 
      pool.totalLiquidity > max.totalLiquidity ? pool : max
    );
    
    const bestAPR = pools.reduce((max, pool) => 
      pool.apr > max.apr ? pool : max
    );
    
    const bestHealth = pools.reduce((max, pool) => 
      pool.healthScore > max.healthScore ? pool : max
    );

    const aggregatedTVL = pools.reduce((sum, pool) => sum + pool.totalLiquidity, 0);
    const aggregatedVolume = pools.reduce((sum, pool) => sum + pool.volume24h, 0);

    return {
      pools,
      bestTVL,
      bestAPR,
      bestHealth,
      aggregatedTVL,
      aggregatedVolume,
    };
  }

  /**
   * Get recent pool events for monitoring
   */
  async getPoolEvents(poolId: string, limit = 50): Promise<PoolEvent[]> {
    logger.info({ poolId, limit }, "Fetching pool events");

    const events = await this.db("pool_events")
      .where("pool_id", poolId)
      .orderBy("timestamp", "desc")
      .limit(limit);

    return events.map(this.mapDbEventToPoolEvent);
  }

  /**
   * Detect large liquidity events
   */
  async detectLargeLiquidityEvents(threshold = 0.1): Promise<PoolEvent[]> {
    logger.info({ threshold }, "Detecting large liquidity events");

    const recentEvents = await this.db("pool_events")
      .where("timestamp", ">", new Date(Date.now() - 24 * 60 * 60 * 1000))
      .orderBy("timestamp", "desc");

    const poolTVLs = new Map<string, number>();
    const pools = await this.getAllPools();
    pools.forEach(pool => poolTVLs.set(pool.id, pool.totalLiquidity));

    return recentEvents
      .map(this.mapDbEventToPoolEvent)
      .filter(event => {
        const tvl = poolTVLs.get(event.poolId) || 0;
        const totalValue = Math.abs(event.amountA) + Math.abs(event.amountB);
        return totalValue / tvl > threshold;
      });
  }

  /**
   * Calculate pool health score (0-100)
   */
  private calculatePoolHealthScore(
    pool: LiquidityPool,
    liquidityDepth: any,
    utilization: number
  ): number {
    let score = 50; // Base score

    // Liquidity depth factor (30% of score)
    const depthScore = Math.min(30, (liquidityDepth.depth1 / pool.totalLiquidity) * 100);
    score += depthScore;

    // Utilization factor (20% of score)
    if (utilization > 0.1 && utilization < 0.9) {
      score += 20;
    } else if (utilization > 0.05 && utilization < 0.95) {
      score += 10;
    }

    // Volume factor (20% of score)
    const volumeScore = Math.min(20, (pool.volume24h / pool.totalLiquidity) * 100);
    score += volumeScore;

    // APR factor (10% of score)
    if (pool.apr > 0 && pool.apr < 50) {
      score += 10;
    } else if (pool.apr > 0 && pool.apr < 100) {
      score += 5;
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Calculate liquidity depth for different price ranges
   */
  private async calculateLiquidityDepth(pool: LiquidityPool) {
    // This would integrate with DEX-specific APIs to get order book depth
    // For now, return estimated values based on pool size
    const tvl = pool.totalLiquidity;
    
    return {
      depth0_1: tvl * 0.01,
      depth0_5: tvl * 0.05,
      depth1: tvl * 0.1,
      depth5: tvl * 0.5,
    };
  }

  /**
   * Get 7-day volume for a pool
   */
  private async getVolume7d(poolId: string): Promise<number> {
    const result = await this.db("pool_events")
      .where("pool_id", poolId)
      .where("timestamp", ">", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      .sum("amount_a as totalA")
      .sum("amount_b as totalB")
      .first();

    return (Number(result?.totalA) || 0) + (Number(result?.totalB) || 0);
  }

  /**
   * Get pool by ID
   */
  private async getPoolById(poolId: string): Promise<LiquidityPool | null> {
    const pool = await this.db("liquidity_pools")
      .where("id", poolId)
      .first();

    return pool ? this.mapDbPoolToLiquidityPool(pool) : null;
  }

  /**
   * Fetch pools from a specific DEX
   */
  private async fetchDEXPools(dex: string): Promise<LiquidityPool[]> {
    switch (dex) {
      case "StellarX":
        return this.fetchStellarXPools();
      case "Phoenix":
        return this.fetchPhoenixPools();
      case "LumenSwap":
        return this.fetchLumenSwapPools();
      case "Soroswap":
        return this.fetchSoroswapPools();
      case "SDEX":
        return this.fetchSDEXPools();
      default:
        return [];
    }
  }

  /**
   * Fetch pools from StellarX AMM
   */
  private async fetchStellarXPools(): Promise<LiquidityPool[]> {
    // This would integrate with StellarX API
    // For now, return mock data
    return [
      {
        id: "stellarx-usdc-xlm",
        assetA: "USDC",
        assetB: "XLM",
        dex: "StellarX",
        totalLiquidity: 1000000,
        reserveA: 500000,
        reserveB: 2000000,
        fee: 0.003,
        apr: 5.2,
        volume24h: 100000,
        healthScore: 75,
        lastUpdated: new Date(),
      },
    ];
  }

  /**
   * Fetch pools from Phoenix DEX
   */
  private async fetchPhoenixPools(): Promise<LiquidityPool[]> {
    // Phoenix DEX integration
    return [
      {
        id: "phoenix-usdc-xlm",
        assetA: "USDC",
        assetB: "XLM",
        dex: "Phoenix",
        totalLiquidity: 800000,
        reserveA: 400000,
        reserveB: 1600000,
        fee: 0.002,
        apr: 4.8,
        volume24h: 80000,
        healthScore: 70,
        lastUpdated: new Date(),
      },
    ];
  }

  /**
   * Fetch pools from LumenSwap
   */
  private async fetchLumenSwapPools(): Promise<LiquidityPool[]> {
    // LumenSwap integration
    return [
      {
        id: "lumenswap-usdc-xlm",
        assetA: "USDC",
        assetB: "XLM",
        dex: "LumenSwap",
        totalLiquidity: 600000,
        reserveA: 300000,
        reserveB: 1200000,
        fee: 0.003,
        apr: 6.1,
        volume24h: 60000,
        healthScore: 68,
        lastUpdated: new Date(),
      },
    ];
  }

  /**
   * Fetch pools from Soroswap
   */
  private async fetchSoroswapPools(): Promise<LiquidityPool[]> {
    // Soroswap integration
    return [
      {
        id: "soroswap-usdc-xlm",
        assetA: "USDC",
        assetB: "XLM",
        dex: "Soroswap",
        totalLiquidity: 400000,
        reserveA: 200000,
        reserveB: 800000,
        fee: 0.004,
        apr: 7.2,
        volume24h: 40000,
        healthScore: 65,
        lastUpdated: new Date(),
      },
    ];
  }

  /**
   * Fetch pools from SDEX (Stellar DEX)
   */
  private async fetchSDEXPools(): Promise<LiquidityPool[]> {
    // SDEX integration
    return [
      {
        id: "sdex-usdc-xlm",
        assetA: "USDC",
        assetB: "XLM",
        dex: "SDEX",
        totalLiquidity: 300000,
        reserveA: 150000,
        reserveB: 600000,
        fee: 0.001,
        apr: 3.5,
        volume24h: 30000,
        healthScore: 60,
        lastUpdated: new Date(),
      },
    ];
  }

  /**
   * Map database pool to LiquidityPool interface
   */
  private mapDbPoolToLiquidityPool(dbPool: any): LiquidityPool {
    return {
      id: dbPool.id,
      assetA: dbPool.asset_a,
      assetB: dbPool.asset_b,
      dex: dbPool.dex,
      contractAddress: dbPool.contract_address,
      totalLiquidity: Number(dbPool.total_liquidity),
      reserveA: Number(dbPool.reserve_a),
      reserveB: Number(dbPool.reserve_b),
      fee: Number(dbPool.fee),
      apr: Number(dbPool.apr),
      volume24h: Number(dbPool.volume_24h),
      healthScore: dbPool.health_score,
      lastUpdated: dbPool.last_updated,
    };
  }

  /**
   * Map database event to PoolEvent interface
   */
  private mapDbEventToPoolEvent(dbEvent: any): PoolEvent {
    return {
      id: dbEvent.id,
      poolId: dbEvent.pool_id,
      type: dbEvent.type,
      amountA: Number(dbEvent.amount_a),
      amountB: Number(dbEvent.amount_b),
      user: dbEvent.user,
      timestamp: dbEvent.timestamp,
      txHash: dbEvent.tx_hash,
    };
  }
}
