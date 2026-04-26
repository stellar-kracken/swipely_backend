import type { MetadataSourceAdapter, MetadataSourcePayload, MetadataSyncContext } from "./assetMetadataSync.types.js";

interface StaticMetadataRecord {
  website_url?: string;
  description?: string;
  documentation_url?: string;
  category?: string;
  tags?: string[];
  logo_url?: string;
  social_links?: Record<string, string>;
  token_specifications?: Record<string, unknown>;
}

const STATIC_METADATA: Record<string, StaticMetadataRecord> = {
  XLM: {
    website_url: "https://stellar.org",
    description:
      "Stellar is an open-source network for currencies and payments.",
    documentation_url: "https://developers.stellar.org",
    category: "Native",
    tags: ["native", "payment", "stellar"],
    logo_url:
      "https://assets.coingecko.com/coins/images/100/large/Stellar_symbol_black_RGB.png",
    social_links: {
      twitter: "https://twitter.com/StellarOrg",
      github: "https://github.com/stellar",
    },
    token_specifications: {
      token_type: "Native",
      standard: "Stellar Native Asset",
      decimals: 7,
    },
  },
  USDC: {
    website_url: "https://www.circle.com/en/usdc",
    description: "USDC is a fully reserved US dollar stablecoin by Circle.",
    documentation_url: "https://developers.circle.com",
    category: "Stablecoin",
    tags: ["stablecoin", "usd", "circle"],
    logo_url:
      "https://assets.coingecko.com/coins/images/6319/large/USD_Coin_icon.png",
    social_links: {
      twitter: "https://twitter.com/circle",
      github: "https://github.com/circlefin",
    },
    token_specifications: {
      token_type: "Stablecoin",
      standard: "Stellar Asset",
      decimals: 7,
    },
  },
  EURC: {
    website_url: "https://www.circle.com/en/eurc",
    description: "EURC is a euro-backed stablecoin issued by Circle.",
    documentation_url: "https://developers.circle.com",
    category: "Stablecoin",
    tags: ["stablecoin", "euro", "circle"],
    logo_url:
      "https://assets.coingecko.com/coins/images/26045/large/euro-coin.png",
    social_links: {
      twitter: "https://twitter.com/circle",
      github: "https://github.com/circlefin",
    },
    token_specifications: {
      token_type: "Stablecoin",
      standard: "Stellar Asset",
      decimals: 7,
    },
  },
  PYUSD: {
    website_url: "https://www.paypal.com/pyusd",
    description: "PYUSD is a US dollar stablecoin issued by PayPal.",
    documentation_url:
      "https://www.paypal.com/us/digital-wallet/manage-money/crypto/pyusd",
    category: "Stablecoin",
    tags: ["stablecoin", "paypal"],
    logo_url:
      "https://assets.coingecko.com/coins/images/31212/large/PYUSD_Logo.png",
    social_links: {
      twitter: "https://twitter.com/PayPal",
    },
    token_specifications: {
      token_type: "Stablecoin",
      standard: "Stellar Asset",
      decimals: 7,
    },
  },
};

export class StaticMetadataSource implements MetadataSourceAdapter {
  public readonly source = "static-registry";

  supports(symbol: string): boolean {
    return Boolean(STATIC_METADATA[symbol.toUpperCase()]);
  }

  async fetch(context: MetadataSyncContext): Promise<MetadataSourcePayload | null> {
    const record = STATIC_METADATA[context.symbol.toUpperCase()];
    if (!record) {
      return null;
    }

    return {
      source: this.source,
      confidence: 0.95,
      data: record,
    };
  }
}
