import type { Knex } from "knex";

export async function minimalAsset(db: Knex): Promise<void> {
  await db("assets").insert({
    symbol: "XLM",
    name: "Stellar Lumens",
    issuer: null,
    asset_type: "native",
    bridge_provider: null,
    source_chain: null,
    is_active: true,
  });
}
