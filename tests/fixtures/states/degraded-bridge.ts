import type { Knex } from "knex";

export async function degradedBridge(db: Knex): Promise<void> {
  await db("assets").insert({
    symbol: "USDC",
    name: "USD Coin",
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    asset_type: "credit_alphanum4",
    bridge_provider: "Circle",
    source_chain: "Ethereum",
    is_active: true,
  });

  // 15% mismatch: supply_on_stellar is higher than source by 15%
  const sourceSupply = 500_000;
  const stellarSupply = Math.round(sourceSupply * 1.15);

  await db("bridges").insert({
    name: "Circle",
    source_chain: "Ethereum",
    status: "degraded",
    total_value_locked: sourceSupply + stellarSupply,
    supply_on_stellar: stellarSupply,
    supply_on_source: sourceSupply,
    is_active: true,
  });
}
