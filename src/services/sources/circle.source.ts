/**
 * Circle API price source.
 *
 * Fetches "official" price and supply data for USDC and EURC directly from
 * Circle, the issuer of both stablecoins.  This acts as one authoritative
 * reference source within the multi-source VWAP aggregation pipeline.
 *
 * API reference: https://developers.circle.com/circle-mint/reference
 *
 * Endpoints used:
 *   GET /v1/stablecoins           – total circulating supply per chain (public)
 *   GET /v1/exchange-rates        – FX rates used to derive EURC/USD price (auth)
 */

import { redis } from "../../utils/redis.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import { withRetry } from "../../utils/retry.js";
import { PriceFetchError } from "../price.service.js";

// ---------------------------------------------------------------------------
// Circle API response shapes
// ---------------------------------------------------------------------------

interface CircleChain {
  amount: string;
  chain: string;
  updateDate: string;
}

interface CircleStablecoin {
  name: string;
  symbol: string;
  totalSupply: string;
  chains: CircleChain[];
}

interface CircleStablecoinsResponse {
  data: CircleStablecoin[];
}

interface CircleExchangeRatesResponse {
  data: {
    currency: string;
    rates: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface CirclePriceResult {
  price: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_NAME = "Circle";
const CACHE_PREFIX = "circle:price:";
const RATE_LIMIT_REDIS_KEY = "circle:rl:count";

/** Symbols this source can serve */
const SUPPORTED_SYMBOLS = new Set(["USDC", "EURC"]);

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class CircleRateLimitError extends Error {
  constructor() {
    super("Circle API in-process rate limit reached");
    this.name = "CircleRateLimitError";
  }
}

export class CircleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "CircleApiError";
  }
}

// ---------------------------------------------------------------------------
// Rate limiter (Redis-backed, shared across instances)
// ---------------------------------------------------------------------------

async function acquireRateLimit(): Promise<void> {
  const windowMs = config.CIRCLE_RATE_LIMIT_WINDOW_MS;
  const maxRequests = config.CIRCLE_RATE_LIMIT_MAX;

  try {
    const current = await redis.incr(RATE_LIMIT_REDIS_KEY);
    if (current === 1) {
      // First request in the window — set the expiry
      await redis.pexpire(RATE_LIMIT_REDIS_KEY, windowMs);
    }
    if (current > maxRequests) {
      const ttlMs = await redis.pttl(RATE_LIMIT_REDIS_KEY);
      logger.warn(
        { current, maxRequests, ttlMs },
        "Circle API rate limit reached"
      );
      throw new CircleRateLimitError();
    }
  } catch (err) {
    if (err instanceof CircleRateLimitError) throw err;
    // Redis error — fail open (allow the request through)
    logger.warn({ err }, "Circle rate-limit Redis check failed, proceeding");
  }
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// CircleSource class
// ---------------------------------------------------------------------------

export class CircleSource {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly cacheTtlSec: number;

  constructor() {
    this.baseUrl = config.CIRCLE_API_URL;
    this.timeoutMs = config.CIRCLE_API_TIMEOUT_MS;
    this.cacheTtlSec = config.CIRCLE_CACHE_TTL_SEC;

    this.headers = {
      Accept: "application/json",
      ...(config.CIRCLE_API_KEY
        ? { Authorization: `Bearer ${config.CIRCLE_API_KEY}` }
        : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Public interface
  // -------------------------------------------------------------------------

  /**
   * Returns true if this source can provide data for the given symbol.
   */
  static supports(symbol: string): boolean {
    return SUPPORTED_SYMBOLS.has(symbol.toUpperCase());
  }

  /**
   * Fetch price data shaped for PriceService.calculateVWAP().
   * Results are Redis-cached; cache misses trigger a live API call with
   * exponential-backoff retries.
   */
  async getPriceSourceData(
    symbol: string
  ): Promise<{ price: number; volume: number; name: string }> {
    const upper = symbol.toUpperCase();
    if (!SUPPORTED_SYMBOLS.has(upper)) {
      throw new PriceFetchError(
        `Circle source does not support ${symbol}`,
        SOURCE_NAME,
        symbol
      );
    }

    const cacheKey = `${CACHE_PREFIX}${upper}`;

    // --- cache read ---
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug({ symbol, cacheKey }, "Circle price cache hit");
        const parsed = JSON.parse(cached) as CirclePriceResult;
        return { ...parsed, name: SOURCE_NAME };
      }
    } catch (redisErr) {
      logger.warn({ redisErr, symbol }, "Circle cache read error");
    }

    // --- live fetch with retry ---
    const result = await withRetry(
      () => this.fetchLive(upper),
      config.RETRY_MAX,
      500 // base delay ms, doubles each attempt
    );

    // --- cache write ---
    try {
      await redis.set(
        cacheKey,
        JSON.stringify(result),
        "EX",
        this.cacheTtlSec
      );
    } catch (redisErr) {
      logger.warn({ redisErr, symbol }, "Circle cache write error");
    }

    logger.info(
      { symbol, price: result.price, volume: result.volume, source: SOURCE_NAME },
      "Circle price fetched"
    );

    return { ...result, name: SOURCE_NAME };
  }

  // -------------------------------------------------------------------------
  // Live fetch logic
  // -------------------------------------------------------------------------

  private async fetchLive(symbol: string): Promise<CirclePriceResult> {
    try {
      const stablecoins = await this.fetchStablecoins();
      const coin = stablecoins.find(
        (c) => c.symbol.toUpperCase() === symbol
      );

      // Total circulating supply across all chains — used as volume proxy
      const totalSupply = coin
        ? coin.chains.reduce(
            (sum, ch) => sum + parseFloat(ch.amount || "0"),
            0
          )
        : 1_000_000_000; // fallback: 1B USD if Circle doesn't return supply

      if (symbol === "USDC") {
        // USDC is pegged 1:1 to USD by Circle; this is the authoritative price.
        return { price: 1.0, volume: totalSupply };
      }

      // EURC is pegged to EUR; its USD price = EUR/USD exchange rate.
      const eurUsd = await this.fetchEURUSDRate();
      return { price: eurUsd, volume: totalSupply };
    } catch (err) {
      if (err instanceof CircleRateLimitError) throw err;
      if (err instanceof CircleApiError) throw err;
      throw new PriceFetchError(
        `Circle live fetch failed for ${symbol}`,
        SOURCE_NAME,
        symbol,
        err
      );
    }
  }

  // -------------------------------------------------------------------------
  // Stablecoin supply endpoint
  // -------------------------------------------------------------------------

  /**
   * GET /v1/stablecoins
   * Returns circulating supply for all Circle stablecoins across chains.
   * This endpoint is public (no auth required).
   */
  private async fetchStablecoins(): Promise<CircleStablecoin[]> {
    await acquireRateLimit();

    const url = `${this.baseUrl}/v1/stablecoins`;
    const start = Date.now();

    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        { method: "GET", headers: this.headers },
        this.timeoutMs
      );
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      logger.error(
        { url, err, isTimeout },
        "Circle stablecoins request failed"
      );
      throw new CircleApiError(
        isTimeout ? "Circle API request timed out" : "Circle API unreachable",
        0
      );
    }

    const durationMs = Date.now() - start;
    logger.info(
      { url, status: response.status, durationMs },
      "Circle stablecoins API call"
    );

    if (!response.ok) {
      throw new CircleApiError(
        `Circle /v1/stablecoins returned ${response.status}`,
        response.status
      );
    }

    const body = (await response.json()) as CircleStablecoinsResponse;
    return body.data ?? [];
  }

  // -------------------------------------------------------------------------
  // Exchange rate endpoint
  // -------------------------------------------------------------------------

  /**
   * GET /v1/exchange-rates?currency=EUR
   *
   * Returns how much 1 EUR is worth in other currencies.
   * Response shape: { data: { currency: "EUR", rates: { "USD": "1.0875", ... } } }
   *
   * Falls back to a stale Redis cache or a conservative estimate on failure.
   */
  private async fetchEURUSDRate(): Promise<number> {
    const rateCacheKey = `${CACHE_PREFIX}eurc:eur-usd-rate`;

    // Try fresh fetch first
    try {
      await acquireRateLimit();

      const url = `${this.baseUrl}/v1/exchange-rates?currency=EUR`;
      const start = Date.now();

      const response = await fetchWithTimeout(
        url,
        { method: "GET", headers: this.headers },
        this.timeoutMs
      );

      const durationMs = Date.now() - start;
      logger.info(
        { url, status: response.status, durationMs },
        "Circle exchange-rates API call"
      );

      if (response.ok) {
        const body = (await response.json()) as CircleExchangeRatesResponse;
        const usdRate = body.data?.rates?.["USD"];

        if (usdRate && !isNaN(parseFloat(usdRate))) {
          const price = parseFloat(usdRate);
          // Cache the FX rate briefly — it changes more frequently than supply
          await redis
            .set(rateCacheKey, String(price), "EX", 30)
            .catch(() => undefined);
          return price;
        }
      }

      logger.warn(
        { status: response.status },
        "Circle exchange-rates response unusable, checking stale cache"
      );
    } catch (err) {
      if (err instanceof CircleRateLimitError) {
        logger.warn("Circle rate limit hit while fetching EUR/USD, using cache");
      } else {
        logger.warn({ err }, "Circle exchange-rates fetch error, using cache");
      }
    }

    // Fall back to stale cached rate
    try {
      const stale = await redis.get(rateCacheKey);
      if (stale) {
        logger.warn(
          { staleRate: stale },
          "Using stale Circle EUR/USD rate from cache"
        );
        return parseFloat(stale);
      }
    } catch {
      // Redis unavailable — fall through to hard fallback
    }

    // Absolute last resort: log loudly and return a conservative estimate
    logger.error(
      "No EUR/USD rate available from Circle API or cache — using emergency fallback"
    );
    return 1.08;
  }
}
