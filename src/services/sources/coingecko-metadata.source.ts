import { logger } from "../../utils/logger.js";
import type { MetadataSourceAdapter, MetadataSourcePayload, MetadataSyncContext } from "./assetMetadataSync.types.js";

const BASE_URL = "https://api.coingecko.com/api/v3";
const TIMEOUT_MS = 8000;

const SYMBOL_TO_ID: Record<string, string> = {
  XLM: "stellar",
  USDC: "usd-coin",
  EURC: "euro-coin",
  PYUSD: "paypal-usd",
  FOBXX: "franklin-onchain-u-s-government-money-fund",
};

interface CoinGeckoCoinResponse {
  image?: {
    large?: string;
  };
  description?: {
    en?: string;
  };
  links?: {
    homepage?: string[];
    repos_url?: { github?: string[] };
    twitter_screen_name?: string;
  };
  categories?: string[];
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class CoinGeckoMetadataSource implements MetadataSourceAdapter {
  public readonly source = "coingecko";

  supports(symbol: string): boolean {
    return Boolean(SYMBOL_TO_ID[symbol.toUpperCase()]);
  }

  async fetch(context: MetadataSyncContext): Promise<MetadataSourcePayload | null> {
    const coinId = SYMBOL_TO_ID[context.symbol.toUpperCase()];
    if (!coinId) {
      return null;
    }

    const url = `${BASE_URL}/coins/${coinId}`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`CoinGecko metadata returned ${response.status}`);
    }

    const payload = (await response.json()) as CoinGeckoCoinResponse;
    const homepage = payload.links?.homepage?.find((item) => Boolean(item));
    const github = payload.links?.repos_url?.github?.find((item) => Boolean(item));
    const twitter = payload.links?.twitter_screen_name
      ? `https://twitter.com/${payload.links.twitter_screen_name}`
      : undefined;

    logger.debug({ symbol: context.symbol, source: this.source }, "Fetched metadata from CoinGecko");

    return {
      source: this.source,
      confidence: 0.7,
      data: {
        logo_url: payload.image?.large,
        description: payload.description?.en,
        website_url: homepage,
        category: payload.categories?.[0],
        tags: payload.categories?.slice(0, 5),
        social_links: {
          ...(github ? { github } : {}),
          ...(twitter ? { twitter } : {}),
        },
      },
    };
  }
}
