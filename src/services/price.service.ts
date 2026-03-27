import { logger } from "../utils/logger.js";
import { redis } from "../utils/redis.js";
import { config, SUPPORTED_ASSETS } from "../config/index.js";
import { getOrderBook, getLiquidityPools, HorizonTimeoutError, HorizonClientError } from "../utils/stellar.js";
import * as StellarSdk from "@stellar/stellar-sdk";

export class PriceFetchError extends Error {
  constructor(message: string, public readonly source: string, public readonly asset: string, public readonly originalError?: unknown) {
    super(message);
    this.name = "PriceFetchError";
  }
}

export interface PriceSource {
  source: string;
  price: number;
  timestamp: string;
}

export interface AggregatedPrice {
  symbol: string;
  vwap: number;
  sources: PriceSource[];
  deviation: number;
  lastUpdated: string;
}

export class PriceService {
  private getAssetConfig(symbol: string) {
    const asset = SUPPORTED_ASSETS.find(a => a.code === symbol);
    if (!asset) {
      throw new PriceFetchError(`Asset ${symbol} not supported`, "CONFIG", symbol);
    }
    return asset;
  }

  private getUsdcConfig() {
    const usdc = SUPPORTED_ASSETS.find(a => a.code === "USDC");
    if (!usdc) {
      throw new PriceFetchError("USDC config missing", "CONFIG", "USDC");
    }
    return usdc;
  }

  private normalizePoolAsset(asset: string): string {
    if (asset === "native") return "XLM:native";
    if (asset.includes(":")) return asset;
    return `${asset}:`;
  }

  private calculateDeviation(validSources: PriceSource[], vwap: number): number {
    if (validSources.length < 2 || vwap <= 0) return 0;

    const maxDeviation = validSources.reduce((max, source) => {
      const deviation = Math.abs(source.price - vwap) / vwap;
      return Math.max(max, deviation);
    }, 0);

    return Number(maxDeviation.toFixed(6));
  }

  /**
   * Fetches the best available price from the Stellar Classic SDEX orderbook.
   * Calculates a volume-weighted price from the top of the orderbook (depth up to 5).
   * @param {string} symbol - The symbol code of the asset to price against USDC
   * @returns {Promise<{ price: number; volume: number }>} A tuple containing the derived VWAP point price and the total volume evaluated
   * @throws {PriceFetchError} If an error occurs during parsing or the asset config is not found
   */
  async fetchSDEXPrice(symbol: string): Promise<{ price: number; volume: number }> {
    try {
      const assetConfig = this.getAssetConfig(symbol);
      const usdcConfig = this.getUsdcConfig();

      if (symbol === "USDC") return { price: 1, volume: 1000000 };

      const orderbook = await getOrderBook(
        symbol,
        assetConfig.issuer,
        "USDC",
        usdcConfig.issuer
      );

      let totalVolume = 0;
      let weightedPriceSum = 0;

      const depth = Math.min(5, orderbook.bids.length, orderbook.asks.length);
      if (depth === 0) throw new Error("Empty orderbook");

      for (let i = 0; i < depth; i++) {
        const bidPrice = parseFloat(orderbook.bids[i].price);
        const bidVol = parseFloat(orderbook.bids[i].amount);
        const askPrice = parseFloat(orderbook.asks[i].price);
        const askVol = parseFloat(orderbook.asks[i].amount);

        totalVolume += (bidVol + askVol);
        weightedPriceSum += (bidPrice * bidVol) + (askPrice * askVol);
      }

      return {
        price: weightedPriceSum / totalVolume,
        volume: totalVolume
      };
    } catch (error) {
      if (error instanceof HorizonTimeoutError || error instanceof HorizonClientError) throw error;
      throw new PriceFetchError(`Failed to fetch SDEX price for ${symbol}`, "SDEX", symbol, error);
    }
  }

  /**
   * Fetches the asset price from Stellar AMM Liquidity Pools.
   * Retrieves the pool with the largest reserves and calculates price from reserve ratios.
   * @param {string} symbol - The symbol code of the asset to price against USDC
   * @returns {Promise<{ price: number; volume: number }>} A tuple containing the derived price and liquidity volume proxy
   * @throws {PriceFetchError} If an error occurs retrieving the pool or evaluating the reserves
   */
  async fetchAMMPrice(symbol: string): Promise<{ price: number; volume: number }> {
    try {
      const assetConfig = this.getAssetConfig(symbol);
      const usdcConfig = this.getUsdcConfig();

      if (symbol === "USDC") return { price: 1, volume: 1000000 };

      const assetA = assetConfig.code === "XLM" ? StellarSdk.Asset.native() : new StellarSdk.Asset(assetConfig.code, assetConfig.issuer);
      const assetB = new StellarSdk.Asset("USDC", usdcConfig.issuer);

      const pools = await getLiquidityPools(assetA, assetB);
      if (pools.records.length === 0) throw new Error("No liquidity pools found");

      const pool = pools.records.reduce((prev: any, current: any) => {
        const prevReserves = parseFloat(prev.reserves[0].amount) + parseFloat(prev.reserves[1].amount);
        const currentReserves = parseFloat(current.reserves[0].amount) + parseFloat(current.reserves[1].amount);
        return currentReserves > prevReserves ? current : prev;
      });

      const assetADescriptor = symbol === "XLM" ? "XLM:native" : `${assetConfig.code}:${assetConfig.issuer}`;
      const assetBDescriptor = `USDC:${usdcConfig.issuer}`;
      const reserveA = pool.reserves.find((r: any) => this.normalizePoolAsset(r.asset) === assetADescriptor);
      const reserveB = pool.reserves.find((r: any) => this.normalizePoolAsset(r.asset) === assetBDescriptor);

      if (!reserveA || !reserveB) throw new Error("Pool missing required reserves");

      const amountA = parseFloat(reserveA.amount);
      const amountB = parseFloat(reserveB.amount);
      if (amountA === 0) throw new Error("Empty reserves");

      return { price: amountB / amountA, volume: amountB * 2 };
    } catch (error) {
      logger.warn({ error, symbol }, "AMM fetch failed");
      if (error instanceof HorizonTimeoutError || error instanceof HorizonClientError) throw error;
      throw new PriceFetchError(`Failed to fetch AMM price for ${symbol}`, "AMM", symbol, error);
    }
  }

  /**
   * Calculates a pure Volume-Weighted Average Price (VWAP) across multiple independent price sources.
   * Gracefully ignores sources with missing or zero volumes.
   * @param {Array<{ price: number; volume: number; name: string }>} sources - Raw source price and volume data points
   * @returns {{ vwap: number, validSources: PriceSource[] }} The calculated VWAP and the valid sources used
   * @throws {Error} If no valid sources with non-zero volume were evaluated
   */
  calculateVWAP(sources: { price: number; volume: number; name: string }[]): { vwap: number, validSources: PriceSource[] } {
    let totalVolume = 0;
    let sumPriceVolume = 0;
    const validSources: PriceSource[] = [];
    const now = new Date().toISOString();

    for (const s of sources) {
      if (!isNaN(s.price) && !isNaN(s.volume) && s.volume > 0) {
        totalVolume += s.volume;
        sumPriceVolume += (s.price * s.volume);
        validSources.push({ source: s.name, price: s.price, timestamp: now });
      }
    }

    if (totalVolume === 0) throw new Error("No valid sources with volume to calculate VWAP");

    return { vwap: sumPriceVolume / totalVolume, validSources };
  }

  /**
   * Get an aggregated price from all supported Oracle sources.
   * Combines data from Stellar DEX (SDEX) and Stellar AMM Pools.
   * Uses Redis caching with a configurable TTL to keep response times under 500ms.
   * @param {string} symbol - The symbol code to aggregate price data for
   * @returns {Promise<AggregatedPrice | null>} The aggregated price object conforming to AggregatedPrice or null if fundamentally unresolvable
   * @throws {Error} Re-throws first error if all individual fetch sources fail
   */
  async getAggregatedPrice(symbol: string): Promise<AggregatedPrice | null> {
    const normalizedSymbol = symbol.toUpperCase();
    this.getAssetConfig(normalizedSymbol);
    logger.info({ symbol: normalizedSymbol }, "Fetching aggregated price");

    const cacheKey = `${config.REDIS_PRICE_CACHE_PREFIX}:${normalizedSymbol}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as AggregatedPrice;
    } catch (redisError) {
      logger.error({ error: redisError, symbol: normalizedSymbol }, "Redis cache read error");
    }

    const results = await Promise.allSettled([
      this.fetchSDEXPrice(normalizedSymbol),
      this.fetchAMMPrice(normalizedSymbol)
    ]);

    const sourceData: { price: number; volume: number; name: string }[] = [];

    if (results[0].status === "fulfilled") {
      sourceData.push({ ...results[0].value, name: "Stellar DEX" });
    } else {
      logger.warn({ error: results[0].reason, symbol: normalizedSymbol }, "SDEX fetch failed");
    }

    if (results[1].status === "fulfilled") {
      sourceData.push({ ...results[1].value, name: "Stellar AMM" });
    } else {
      logger.warn({ error: results[1].reason, symbol: normalizedSymbol }, "AMM fetch failed");
    }

    if (sourceData.length === 0) {
      const firstError = (results[0] as PromiseRejectedResult).reason || (results[1] as PromiseRejectedResult).reason;
      throw firstError;
    }

    const { vwap, validSources } = this.calculateVWAP(sourceData);

    const aggregated: AggregatedPrice = {
      symbol: normalizedSymbol,
      vwap,
      sources: validSources,
      deviation: this.calculateDeviation(validSources, vwap),
      lastUpdated: new Date().toISOString()
    };

    try {
      await redis.set(cacheKey, JSON.stringify(aggregated), "EX", config.REDIS_CACHE_TTL_SEC);
    } catch (redisError) {
      logger.error({ error: redisError, symbol: normalizedSymbol }, "Redis cache write error");
    }

    return aggregated;
  }

  /**
   * Get price from a specific source
   */
  async getPriceFromSource(
    symbol: string,
    source: string
  ): Promise<PriceSource | null> {
    const normalizedSource = source.toLowerCase();
    logger.info({ symbol, source: normalizedSource }, "Fetching price from specific source");

    const fetchers: Record<string, () => Promise<{ price: number; volume: number }>> = {
      sdex: () => this.fetchSDEXPrice(symbol),
      amm: () => this.fetchAMMPrice(symbol)
    };

    const fetcher = fetchers[normalizedSource];
    if (!fetcher) return null;

    const result = await fetcher();
    return {
      source: normalizedSource.toUpperCase(),
      price: result.price,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check if price deviation exceeds the configured threshold
   */
  async checkDeviation(
    symbol: string
  ): Promise<{ deviated: boolean; percentage: number }> {
    logger.info({ symbol }, "Checking price deviation");
    const aggregated = await this.getAggregatedPrice(symbol);

    if (!aggregated) return { deviated: false, percentage: 0 };

    return {
      deviated: aggregated.deviation > config.PRICE_DEVIATION_THRESHOLD,
      percentage: aggregated.deviation
    };
  }

  /**
   * Get historical price data for charting
   */
  async getHistoricalPrices(
    symbol: string,
    interval: "1h" | "1d" | "7d" | "30d"
  ): Promise<{ timestamp: string; price: number }[]> {
    logger.info({ symbol, interval }, "Fetching historical prices");
    // TODO: Query TimescaleDB for time-bucketed price data
    return [];
  }
}
