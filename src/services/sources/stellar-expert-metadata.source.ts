import type { MetadataSourceAdapter, MetadataSourcePayload, MetadataSyncContext } from "./assetMetadataSync.types.js";

const STELLAR_EXPERT_BASE_URL = "https://api.stellar.expert/explorer/public/asset";
const TIMEOUT_MS = 8000;

interface StellarExpertAssetResponse {
  _embedded?: {
    records?: Array<{
      code?: string;
      domain?: string;
      asset?: string;
    }>;
  };
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

export class StellarExpertMetadataSource implements MetadataSourceAdapter {
  public readonly source = "stellar-expert";

  supports(symbol: string): boolean {
    return symbol.toUpperCase() !== "XLM";
  }

  async fetch(context: MetadataSyncContext): Promise<MetadataSourcePayload | null> {
    const symbol = context.symbol.toUpperCase();
    if (symbol === "XLM") {
      return null;
    }

    const url = `${STELLAR_EXPERT_BASE_URL}?asset=${encodeURIComponent(symbol)}`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`Stellar Expert metadata returned ${response.status}`);
    }

    const payload = (await response.json()) as StellarExpertAssetResponse;
    const firstRecord = payload._embedded?.records?.find((record) => record.code?.toUpperCase() === symbol);

    if (!firstRecord?.domain) {
      return null;
    }

    return {
      source: this.source,
      confidence: 0.6,
      data: {
        website_url: `https://${firstRecord.domain}`,
      },
    };
  }
}
