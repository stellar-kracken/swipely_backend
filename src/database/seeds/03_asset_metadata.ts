import { Knex } from "knex";
import { randomBytes } from "crypto";

export async function seed(knex: Knex): Promise<void> {
  // Get existing assets
  const assets = await knex("assets").select("id", "symbol");

  const metadataSeeds = [
    {
      symbol: "XLM",
      logo_url:
        "https://assets.coingecko.com/coins/images/100/large/Stellar_symbol_black_RGB.png",
      description:
        "Stellar is an open-source network for currencies and payments. Stellar makes it possible to create, send and trade digital representations of all forms of money—dollars, pesos, bitcoin, pretty much anything.",
      website_url: "https://stellar.org",
      social_links: {
        twitter: "https://twitter.com/StellarOrg",
        github: "https://github.com/stellar",
        discord: "https://discord.gg/stellardev",
      },
      documentation_url: "https://developers.stellar.org",
      token_specifications: {
        decimals: 7,
        token_type: "Native",
        standard: "Stellar Native Asset",
      },
      category: "Native",
      tags: ["native", "payment", "defi"],
    },
    {
      symbol: "USDC",
      logo_url:
        "https://assets.coingecko.com/coins/images/6319/large/USD_Coin_icon.png",
      description:
        "USDC is a fully collateralized US dollar stablecoin. USDC is issued by regulated financial institutions, backed by fully reserved assets, redeemable on a 1:1 basis for US dollars.",
      website_url: "https://www.circle.com/en/usdc",
      contract_address:
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      social_links: {
        twitter: "https://twitter.com/circle",
        medium: "https://www.circle.com/blog",
      },
      documentation_url: "https://developers.circle.com",
      token_specifications: {
        decimals: 7,
        token_type: "Stablecoin",
        standard: "Stellar Asset",
      },
      category: "Stablecoin",
      tags: ["stablecoin", "bridged", "circle"],
    },
    {
      symbol: "PYUSD",
      logo_url:
        "https://assets.coingecko.com/coins/images/31212/large/PYUSD_Logo.png",
      description:
        "PayPal USD (PYUSD) is a stablecoin issued by PayPal, designed to be backed 1:1 by U.S. dollar deposits, short-term U.S. Treasuries and similar cash equivalents.",
      website_url: "https://www.paypal.com/pyusd",
      contract_address:
        "GBHZAE5IQTOPQZ66TFWZYIYCHQ6T3GMWHDKFEXAKYWJ2BHLZQ227KRYE",
      social_links: {
        twitter: "https://twitter.com/PayPal",
      },
      documentation_url:
        "https://www.paypal.com/us/digital-wallet/manage-money/crypto/pyusd",
      token_specifications: {
        decimals: 7,
        token_type: "Stablecoin",
        standard: "Stellar Asset",
      },
      category: "Stablecoin",
      tags: ["stablecoin", "bridged", "paypal"],
    },
    {
      symbol: "EURC",
      logo_url:
        "https://assets.coingecko.com/coins/images/26045/large/euro-coin.png",
      description:
        "Euro Coin (EURC) is a euro-backed stablecoin issued by Circle. EURC is always redeemable 1:1 for euros and backed by euro-denominated reserves.",
      website_url: "https://www.circle.com/en/eurc",
      contract_address:
        "GDQOE23CFSUMSVZZ4YRVXGW7PCFNIAHLMRAHDE4Z32DIBQGH4KZZK2KZ",
      social_links: {
        twitter: "https://twitter.com/circle",
        medium: "https://www.circle.com/blog",
      },
      documentation_url: "https://developers.circle.com",
      token_specifications: {
        decimals: 7,
        token_type: "Stablecoin",
        standard: "Stellar Asset",
      },
      category: "Stablecoin",
      tags: ["stablecoin", "bridged", "circle", "euro"],
    },
    {
      symbol: "FOBXX",
      logo_url:
        "https://www.franklintempleton.com/assets/images/common/ft-logo.svg",
      description:
        "Franklin OnChain U.S. Government Money Fund (FOBXX) is a tokenized money market fund that invests in U.S. government securities, cash, and repurchase agreements.",
      website_url:
        "https://www.franklintempleton.com/investments/options/mutual-funds/products/29596/SINGLCLASS/franklin-onchain-us-government-money-fund/FOBXX",
      social_links: {
        twitter: "https://twitter.com/FTI_US",
      },
      documentation_url:
        "https://www.franklintempleton.com/investor-education/blockchain",
      token_specifications: {
        decimals: 7,
        token_type: "RWA",
        standard: "Stellar Asset",
      },
      category: "RWA",
      tags: ["rwa", "money-market", "institutional"],
    },
  ];

  // Insert metadata for each asset
  for (const metadata of metadataSeeds) {
    const asset = assets.find((a) => a.symbol === metadata.symbol);
    if (asset) {
      await knex("asset_metadata").insert({
        id: randomBytes(16).toString("hex"),
        asset_id: asset.id,
        symbol: metadata.symbol,
        logo_url: metadata.logo_url,
        description: metadata.description,
        website_url: metadata.website_url,
        contract_address: metadata.contract_address || null,
        social_links: JSON.stringify(metadata.social_links),
        documentation_url: metadata.documentation_url,
        token_specifications: JSON.stringify(metadata.token_specifications),
        category: metadata.category,
        tags: JSON.stringify(metadata.tags),
        version: 1,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }
}
