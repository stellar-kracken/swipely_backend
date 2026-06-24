import type { Knex } from "knex";

export async function multiAsset(db: Knex): Promise<void> {
  await db("assets").insert([
    {
      symbol: "XLM",
      name: "Stellar Lumens",
      issuer: null,
      asset_type: "native",
      bridge_provider: null,
      source_chain: null,
      is_active: true,
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      asset_type: "credit_alphanum4",
      bridge_provider: "Circle",
      source_chain: "Ethereum",
      is_active: true,
    },
    {
      symbol: "EURC",
      name: "Euro Coin",
      issuer: "GDQOE23CFSUMSVZZ4YRVXGW7PCFNIAHLMRAHDE4Z32DIBQGH4KZZK2KZ",
      asset_type: "credit_alphanum4",
      bridge_provider: "Circle",
      source_chain: "Ethereum",
      is_active: true,
    },
  ]);
}
