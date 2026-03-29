import { logger } from "../utils/logger.js";
import { CacheService } from "../utils/cache.js";
import { config, SUPPORTED_ASSETS } from "../config/index.js";
import {
  getOrderBook,
  getLiquidityPools,
  HorizonTimeoutError,
  HorizonClientError,
} from "../utils/stellar.js";
import * as StellarSdk from "@stellar/stellar-sdk";
import { CircleSource } from "./sources/circle.source.js";

export class PriceFetchError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly asset: string,
    public readonly originalError?: unknown
  ) {
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
  private readonly circleSource = new CircleSource();

  private getAssetConfig(symbol: string) {
    const asset = SUPPORTED_ASSETS.find((a) => a.code === symbol);
    if (!asset) {
      throw new PriceFetchError(
        `Asset ${symbol} not supported`,
        "CONFIG",
        symbol
      );
    }
    return asset;
  }

  private getUsdcConfig() {
    const usdc = SUPPORTED_ASSETS.find((a) => a.code === "USDC");
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
   */
  async fetchSDEXPrice(symbol: string): Promise<{ price: number; volume: number }> {
    const sym = symbol.toUpperCase();
    try {
      const assetConfig = this.getAssetConfig(sym);
      const usdcConfig = this.getUsdcConfig();

      if (sym === "USDC") return { price: 1, volume: 1000000 };

      const orderbook = await getOrderBook(
        sym,
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

        totalVolume += bidVol + askVol;
        weightedPriceSum += bidPrice * bidVol + askPrice * askVol;
      }

      return {
        price: weightedPriceSum / totalVolume,
        volume: totalVolume,
      };
    } catch (error) {
      if (error instanceof HorizonTimeoutError || error instanceof HorizonClientError)
        throw error;
      throw new PriceFetchError(
        `Failed to fetch SDEX price for ${sym}`,
        "SDEX",
        sym,
        error
      );
    }
  }

  /**
   * Fetches the asset price from Stellar AMM liquidity pools.
   */
  async fetchAMMPrice(symbol: string): Promise<{ price: number; volume: number }> {
    const sym = symbol.toUpperCase();
    try {
      const assetConfig = this.getAssetConfig(sym);
      const usdcConfig = this.getUsdcConfig();

      if (sym === "USDC") return { price: 1, volume: 1000000 };

      const assetA =
        assetConfig.code === "XLM"
          ? StellarSdk.Asset.native()
          : new StellarSdk.Asset(assetConfig.code, assetConfig.issuer);
      const assetB = new StellarSdk.Asset("USDC", usdcConfig.issuer);

      const pools = await getLiquidityPools(assetA, assetB);
      if (pools.records.length === 0) throw new Error("No liquidity pools found");

      const pool = pools.records.reduce((prev: any, current: any) => {
        const prevReserves =
          parseFloat(prev.reserves[0].amount) + parseFloat(prev.reserves[1].amount);
        const currentReserves =
          parseFloat(current.reserves[0].amount) +
          parseFloat(current.reserves[1].amount);
        return currentReserves > prevReserves ? current : prev;
      });

      const assetADescriptor =
        sym === "XLM" ? "XLM:native" : `${assetConfig.code}:${assetConfig.issuer}`;
      const assetBDescriptor = `USDC:${usdcConfig.issuer}`;
      const reserveA = pool.reserves.find(
        (r: any) => this.normalizePoolAsset(r.asset) === assetADescriptor
      );
      const reserveB = pool.reserves.find(
        (r: any) => this.normalizePoolAsset(r.asset) === assetBDescriptor
      );

      if (!reserveA || !reserveB) throw new Error("Pool missing required reserves");

      const amountA = parseFloat(reserveA.amount);
      const amountB = parseFloat(reserveB.amount);
      if (amountA === 0) throw new Error("Empty reserves");

      return { price: amountB / amountA, volume: amountB * 2 };
    } catch (error) {
      logger.warn({ error, symbol: sym }, "AMM fetch failed");
      if (error instanceof HorizonTimeoutError || error instanceof HorizonClientError)
        throw error;
      throw new PriceFetchError(
        `Failed to fetch AMM price for ${sym}`,
        "AMM",
        sym,
        error
      );
    }
  }

  /**
   * Volume-weighted average price across sources with non-zero volume.
   */
  calculateVWAP(sources: { price: number; volume: number; name: string }[]): {
    vwap: number;
    validSources: PriceSource[];
  } {
    let totalVolume = 0;
    let sumPriceVolume = 0;
    const validSources: PriceSource[] = [];
    const now = new Date().toISOString();

    for (const s of sources) {
      if (!isNaN(s.price) && !isNaN(s.volume) && s.volume > 0) {
        totalVolume += s.volume;
        sumPriceVolume += s.price * s.volume;
        validSources.push({ source: s.name, price: s.price, timestamp: now });
      }
    }

    if (totalVolume === 0)
      throw new Error("No valid sources with volume to calculate VWAP");

    return { vwap: sumPriceVolume / totalVolume, validSources };
  }

  /**
   * Aggregated VWAP from Stellar DEX, AMM, and Circle (when supported), with Redis caching.
   */
  async getAggregatedPrice(
    symbol: string,
    bypassCache: boolean = false
  ): Promise<AggregatedPrice | null> {
    const normalizedSymbol = symbol.toUpperCase();
    this.getAssetConfig(normalizedSymbol);

    const cacheKey = CacheService.generateKey(
      "price",
      `aggregated:${normalizedSymbol}`
    );

    return CacheService.getOrSet(
      cacheKey,
      async () => {
        logger.info(
          { symbol: normalizedSymbol },
          "Fetching aggregated price from sources"
        );

        const fetches: Promise<{ price: number; volume: number; name: string }>[] = [
          this.fetchSDEXPrice(normalizedSymbol).then((r) => ({
            ...r,
            name: "Stellar DEX",
          })),
          this.fetchAMMPrice(normalizedSymbol).then((r) => ({
            ...r,
            name: "Stellar AMM",
          })),
        ];

        if (CircleSource.supports(normalizedSymbol)) {
          fetches.push(this.circleSource.getPriceSourceData(normalizedSymbol));
        }

        const results = await Promise.allSettled(fetches);

        const sourceData: { price: number; volume: number; name: string }[] = [];
        for (const result of results) {
          if (result.status === "fulfilled") {
            sourceData.push(result.value);
          } else {
            logger.warn(
              { error: result.reason, symbol: normalizedSymbol },
              "Price source fetch failed"
            );
          }
        }

        if (sourceData.length === 0) {
          const rejected = results.find(
            (r): r is PromiseRejectedResult => r.status === "rejected"
          );
          throw rejected?.reason ?? new Error("All price sources failed");
        }

        const { vwap, validSources } = this.calculateVWAP(sourceData);

        return {
          symbol: normalizedSymbol,
          vwap,
          sources: validSources,
          deviation: this.calculateDeviation(validSources, vwap),
          lastUpdated: new Date().toISOString(),
        };
      },
      {
        bypassCache,
        tags: ["price"],
        ttl: config.REDIS_CACHE_TTL_SEC,
      }
    );
  }

  /**
   * Get price from a specific source (sdex, amm, or circle).
   */
  async getPriceFromSource(
    symbol: string,
    source: string
  ): Promise<PriceSource | null> {
    const normalizedSource = source.toLowerCase();
    const normalizedSymbol = symbol.toUpperCase();
    logger.info(
      { symbol: normalizedSymbol, source: normalizedSource },
      "Fetching price from specific source"
    );

    if (normalizedSource === "circle") {
      if (!CircleSource.supports(normalizedSymbol)) return null;
      const { price } =
        await this.circleSource.getPriceSourceData(normalizedSymbol);
      return {
        source: "Circle",
        price,
        timestamp: new Date().toISOString(),
      };
    }

    const fetchers: Record<
      string,
      () => Promise<{ price: number; volume: number }>
    > = {
      sdex: () => this.fetchSDEXPrice(normalizedSymbol),
      amm: () => this.fetchAMMPrice(normalizedSymbol),
    };

    const fetcher = fetchers[normalizedSource];
    if (!fetcher) return null;

    const result = await fetcher();
    return {
      source: normalizedSource.toUpperCase(),
      price: result.price,
      timestamp: new Date().toISOString(),
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
      percentage: aggregated.deviation,
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
