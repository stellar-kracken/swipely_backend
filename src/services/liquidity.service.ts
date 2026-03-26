import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { redis } from "../utils/redis.js";
import { SUPPORTED_ASSETS } from "../config/index.js";
import {
  getOrderBook,
  getLiquidityPools,
  withHorizonTimeout,
  HorizonTimeoutError,
  HorizonClientError,
} from "../utils/stellar.js";

export interface PriceLevel {
  priceImpact: number;
  totalAmount: number;
}

export interface LiquiditySource {
  dex: string;
  pair: string;
  totalLiquidity: number;
  bidDepth: number;
  askDepth: number;
  priceLevels: PriceLevel[];
  lastUpdated: string;
}

export interface AggregatedLiquidity {
  symbol: string;
  totalLiquidity: number;
  sources: LiquiditySource[];
  bestBid: { dex: string; price: number };
  bestAsk: { dex: string; price: number };
  lastUpdated: string;
}

interface OrderbookData {
  bestBidPrice: number;
  bestAskPrice: number;
  bidDepth: number;
  askDepth: number;
  priceLevels: PriceLevel[];
}

interface ContractLiquidityDepth {
  asset_pair: string;
  total_liquidity: string | number | bigint;
  depth_0_1_pct: string | number | bigint;
  depth_0_5_pct: string | number | bigint;
  depth_1_pct: string | number | bigint;
  depth_5_pct: string | number | bigint;
  sources: string[];
  timestamp: string | number | bigint;
}

const PHASE1_PAIR_MAP: Record<string, string[]> = {
  USDC: ["USDC/XLM", "FOBXX/USDC"],
  EURC: ["EURC/XLM"],
  PYUSD: ["PYUSD/XLM"],
  FOBXX: ["FOBXX/USDC"],
  XLM: ["USDC/XLM", "EURC/XLM", "PYUSD/XLM"],
};

function getSorobanServer(): StellarSdk.SorobanRpc.Server {
  return new StellarSdk.SorobanRpc.Server(config.SOROBAN_RPC_URL, {
    allowHttp: config.NODE_ENV === "development",
  });
}

function getNetworkPassphrase(): string {
  return config.STELLAR_NETWORK === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
}

function toNumber(value: string | number | bigint | undefined): number {
  if (value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

export class LiquidityService {
  private static readonly PRICE_IMPACT_LEVELS = [0.001, 0.005, 0.01, 0.05];
  private static readonly CACHE_TTL_SEC = 60;
  private circuitBreakerState: Map<string, { failures: number; lastFailure: number }> = new Map();
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 3;
  private static readonly CIRCUIT_BREAKER_RESET_MS = 60000;

  private isCircuitBreakerOpen(endpoint: string): boolean {
    const state = this.circuitBreakerState.get(endpoint);
    if (!state) return false;

    const timeSinceLastFailure = Date.now() - state.lastFailure;
    if (timeSinceLastFailure > LiquidityService.CIRCUIT_BREAKER_RESET_MS) {
      this.circuitBreakerState.delete(endpoint);
      return false;
    }

    return state.failures >= LiquidityService.CIRCUIT_BREAKER_THRESHOLD;
  }

  private recordFailure(endpoint: string): void {
    const state = this.circuitBreakerState.get(endpoint) || { failures: 0, lastFailure: Date.now() };
    state.failures += 1;
    state.lastFailure = Date.now();
    this.circuitBreakerState.set(endpoint, state);
  }

  private resetCircuitBreaker(endpoint: string): void {
    this.circuitBreakerState.delete(endpoint);
  }

  /**
   * Calculate depth at various price impact levels from an orderbook.
   */
  private calculateDepthLevels(
    prices: Array<{ price: string; amount: string }>,
    bestPrice: number,
    isBid: boolean
  ): PriceLevel[] {
    const levels: PriceLevel[] = [];

    for (const impact of LiquidityService.PRICE_IMPACT_LEVELS) {
      let totalAmount = 0;
      const targetPrice = isBid ? bestPrice * (1 - impact) : bestPrice * (1 + impact);

      for (const level of prices) {
        const price = parseFloat(level.price);
        const amount = parseFloat(level.amount);

        const priceValid = isBid ? price >= targetPrice : price <= targetPrice;
        if (priceValid) {
          totalAmount += amount;
        } else {
          break;
        }
      }

      levels.push({ priceImpact: impact, totalAmount });
    }

    return levels;
  }

  /**
   * Fetch SDEX liquidity and calculate depth levels.
   */
  private async fetchSDEXLiquidity(symbol: string, counterSymbol: string): Promise<OrderbookData | null> {
    try {
      if (this.isCircuitBreakerOpen("SDEX")) {
        logger.warn({ symbol }, "SDEX endpoint circuit breaker open, skipping");
        return null;
      }

      const assetConfig = SUPPORTED_ASSETS.find(a => a.code === symbol);
      const counterConfig = SUPPORTED_ASSETS.find(a => a.code === counterSymbol);

      if (!assetConfig || !counterConfig) return null;

      const orderbook = await withHorizonTimeout(
        getOrderBook(symbol, assetConfig.issuer, counterSymbol, counterConfig.issuer)
      );

      if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
        return null;
      }

      const bestBidPrice = parseFloat(orderbook.bids[0].price);
      const bestAskPrice = parseFloat(orderbook.asks[0].price);

      const bidDepth = orderbook.bids.reduce((sum, level) => sum + parseFloat(level.amount), 0);
      const askDepth = orderbook.asks.reduce((sum, level) => sum + parseFloat(level.amount), 0);

      const bidLevels = this.calculateDepthLevels(orderbook.bids, bestBidPrice, true);
      const askLevels = this.calculateDepthLevels(orderbook.asks, bestAskPrice, false);

      this.resetCircuitBreaker("SDEX");

      return {
        bestBidPrice,
        bestAskPrice,
        bidDepth,
        askDepth,
        priceLevels: [...bidLevels, ...askLevels],
      };
    } catch (error) {
      this.recordFailure("SDEX");
      logger.warn({ symbol, error }, "Failed to fetch SDEX liquidity");
      if (error instanceof HorizonTimeoutError || error instanceof HorizonClientError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetch AMM liquidity and calculate depth levels.
   */
  private async fetchAMMLiquidity(symbol: string, counterSymbol: string): Promise<OrderbookData | null> {
    try {
      if (this.isCircuitBreakerOpen("AMM")) {
        logger.warn({ symbol }, "AMM endpoint circuit breaker open, skipping");
        return null;
      }

      const assetConfig = SUPPORTED_ASSETS.find(a => a.code === symbol);
      const counterConfig = SUPPORTED_ASSETS.find(a => a.code === counterSymbol);

      if (!assetConfig || !counterConfig) return null;

      const assetA =
        symbol === "XLM"
          ? StellarSdk.Asset.native()
          : new StellarSdk.Asset(symbol, assetConfig.issuer);
      const assetB = new StellarSdk.Asset(counterSymbol, counterConfig.issuer);

      const pools = await withHorizonTimeout(getLiquidityPools(assetA, assetB));

      if (pools.records.length === 0) {
        return null;
      }

      let totalBidDepth = 0;
      let totalAskDepth = 0;
      let bestBidPrice = 0;
      let bestAskPrice = 0;
      const allLevels: PriceLevel[] = [];

      for (const pool of pools.records) {
        const reserveA = pool.reserves.find((r: any) =>
          symbol === "XLM"
            ? r.asset.includes("native")
            : r.asset.includes(symbol)
        );
        const reserveB = pool.reserves.find((r: any) =>
          r.asset.includes(counterSymbol)
        );

        if (!reserveA || !reserveB) continue;

        const amountA = parseFloat(reserveA.amount);
        const amountB = parseFloat(reserveB.amount);

        if (amountA === 0) continue;

        const price = amountB / amountA;
        totalBidDepth += amountA;
        totalAskDepth += amountB;

        if (bestBidPrice === 0 || price > bestBidPrice) {
          bestBidPrice = price;
        }
        if (bestAskPrice === 0 || price < bestAskPrice) {
          bestAskPrice = price;
        }
      }

      if (totalBidDepth === 0 || totalAskDepth === 0) {
        return null;
      }

      // For AMM, approximate depth levels based on total liquidity
      for (const impact of LiquidityService.PRICE_IMPACT_LEVELS) {
        const availableAmount = totalBidDepth * (1 - impact);
        allLevels.push({ priceImpact: impact, totalAmount: availableAmount });
      }

      this.resetCircuitBreaker("AMM");

      return {
        bestBidPrice: bestBidPrice === 0 ? 1 : bestBidPrice,
        bestAskPrice: bestAskPrice === 0 ? 1 : bestAskPrice,
        bidDepth: totalBidDepth,
        askDepth: totalAskDepth,
        priceLevels: allLevels,
      };
    } catch (error) {
      this.recordFailure("AMM");
      logger.warn({ symbol, error }, "Failed to fetch AMM liquidity");
      if (error instanceof HorizonTimeoutError || error instanceof HorizonClientError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get aggregated liquidity data for an asset across SDEX and StellarX AMM.
   * Supports Phase 1 asset pairs (against USDC).
   * Caches results in Redis for 60 seconds.
   */
  async getAggregatedLiquidity(symbol: string): Promise<AggregatedLiquidity | null> {
    logger.info({ symbol }, "Fetching aggregated liquidity");

    const cacheKey = `liquidity:aggregated:${symbol}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug({ symbol }, "Returning cached aggregated liquidity");
        return JSON.parse(cached) as AggregatedLiquidity;
      }
    } catch (redisError) {
      logger.error({ error: redisError, symbol }, "Redis cache read error");
    }

    const counterSymbol = "USDC";

    try {
      const results = await Promise.allSettled([
        this.fetchSDEXLiquidity(symbol, counterSymbol),
        this.fetchAMMLiquidity(symbol, counterSymbol),
      ]);

      const sources: LiquiditySource[] = [];
      let bestBid = { dex: "", price: 0 };
      let bestAsk = { dex: "", price: Infinity };
      let totalLiquidity = 0;

      if (results[0].status === "fulfilled" && results[0].value) {
        const sdexData = results[0].value;
        sources.push({
          dex: "SDEX",
          pair: `${symbol}/${counterSymbol}`,
          totalLiquidity: sdexData.bidDepth + sdexData.askDepth,
          bidDepth: sdexData.bidDepth,
          askDepth: sdexData.askDepth,
          priceLevels: sdexData.priceLevels,
          lastUpdated: new Date().toISOString(),
        });

        totalLiquidity += sdexData.bidDepth + sdexData.askDepth;

        if (sdexData.bestBidPrice > bestBid.price) {
          bestBid = { dex: "SDEX", price: sdexData.bestBidPrice };
        }
        if (sdexData.bestAskPrice < bestAsk.price) {
          bestAsk = { dex: "SDEX", price: sdexData.bestAskPrice };
        }
      } else if (results[0].status === "rejected") {
        logger.warn({ error: results[0].reason, symbol }, "SDEX fetch error");
      }

      if (results[1].status === "fulfilled" && results[1].value) {
        const ammData = results[1].value;
        sources.push({
          dex: "StellarX AMM",
          pair: `${symbol}/${counterSymbol}`,
          totalLiquidity: ammData.bidDepth + ammData.askDepth,
          bidDepth: ammData.bidDepth,
          askDepth: ammData.askDepth,
          priceLevels: ammData.priceLevels,
          lastUpdated: new Date().toISOString(),
        });

        totalLiquidity += ammData.bidDepth + ammData.askDepth;

        if (ammData.bestBidPrice > bestBid.price) {
          bestBid = { dex: "StellarX AMM", price: ammData.bestBidPrice };
        }
        if (ammData.bestAskPrice < bestAsk.price) {
          bestAsk = { dex: "StellarX AMM", price: ammData.bestAskPrice };
        }
      } else if (results[1].status === "rejected") {
        logger.warn({ error: results[1].reason, symbol }, "AMM fetch error");
      }

      if (sources.length === 0) {
        logger.warn({ symbol }, "No liquidity data available from any source");
        return null;
      }

      const aggregated: AggregatedLiquidity = {
        symbol,
        totalLiquidity,
        sources,
        bestBid: bestBid.dex ? bestBid : { dex: sources[0].dex, price: 0 },
        bestAsk: bestAsk.dex ? bestAsk : { dex: sources[0].dex, price: 0 },
        lastUpdated: new Date().toISOString(),
      };

      try {
        await redis.set(
          cacheKey,
          JSON.stringify(aggregated),
          "EX",
          LiquidityService.CACHE_TTL_SEC
        );
      } catch (redisError) {
        logger.error({ error: redisError, symbol }, "Redis cache write error");
      }

      return aggregated;
    } catch (error) {
      logger.error({ error, symbol }, "Error fetching aggregated liquidity");
      throw error;
    }
  }

  /**
   * Get liquidity from a specific DEX by filtering the aggregated result.
   */
  async getDexLiquidity(symbol: string, dex: string): Promise<LiquiditySource | null> {
    logger.info({ symbol, dex }, "Fetching DEX-specific liquidity");

    const aggregated = await this.getAggregatedLiquidity(symbol);
    if (!aggregated) {
      return null;
    }

    return aggregated.sources.find((source) => source.dex === dex) ?? null;
  }

  /**
   * Calculate optimal trade route across DEXs.
   */
  async getBestRoute(
    fromSymbol: string,
    toSymbol: string,
    amount: number
  ): Promise<{ route: string[]; estimatedOutput: number }> {
    logger.info({ fromSymbol, toSymbol, amount }, "Calculating best route");

    const pair = `${fromSymbol}/${toSymbol}`;
    const inversePair = `${toSymbol}/${fromSymbol}`;
    const snapshot =
      (await this.fetchPairLiquidityDepth(pair)) ??
      (await this.fetchPairLiquidityDepth(inversePair));

    if (!snapshot) {
      return { route: [], estimatedOutput: 0 };
    }

    const route = snapshot.sources.length > 0 ? [snapshot.sources[0]] : [];
    const executableLiquidity = Math.min(
      amount,
      toNumber(snapshot.depth_1_pct)
    );

    return {
      route,
      estimatedOutput: executableLiquidity,
    };
  }

  private getPairsForSymbol(symbol: string): string[] {
    return PHASE1_PAIR_MAP[symbol.toUpperCase()] ?? [];
  }

  private async fetchPairLiquidityDepth(
    assetPair: string
  ): Promise<ContractLiquidityDepth | null> {
    if (!config.LIQUIDITY_CONTRACT_ADDRESS) {
      return null;
    }

    const server = getSorobanServer();
    const contract = new StellarSdk.Contract(config.LIQUIDITY_CONTRACT_ADDRESS);
    const account = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "0");

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          "get_aggregated_liquidity_depth",
          StellarSdk.xdr.ScVal.scvString(assetPair)
        )
      )
      .setTimeout(10)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (StellarSdk.SorobanRpc.Api.isSimulationError(simResult)) {
      logger.warn({ assetPair, error: simResult.error }, "Liquidity depth simulation failed");
      return null;
    }

    const retval = simResult.result?.retval;
    if (!retval) {
      return null;
    }

    const nativeValue = StellarSdk.scValToNative(retval) as
      | ContractLiquidityDepth
      | null
      | undefined;

    return nativeValue ?? null;
  }
}
