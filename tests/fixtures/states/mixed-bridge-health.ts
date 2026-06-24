import type { Knex } from "knex";

export async function mixedBridgeHealth(db: Knex): Promise<void> {
  await db("assets").insert([
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

  await db("bridges").insert([
    {
      name: "Circle",
      source_chain: "Ethereum",
      status: "healthy",
      total_value_locked: 1_000_000,
      supply_on_stellar: 500_000,
      supply_on_source: 500_000,
      is_active: true,
    },
    {
      name: "Wormhole",
      source_chain: "Ethereum",
      status: "down",
      total_value_locked: 0,
      supply_on_stellar: 0,
      supply_on_source: 0,
      is_active: true,
    },
  ]);
}
