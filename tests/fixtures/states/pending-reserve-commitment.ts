import type { Knex } from "knex";

export async function pendingReserveCommitment(db: Knex): Promise<void> {
  await db("assets").insert({
    symbol: "USDC",
    name: "USD Coin",
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    asset_type: "credit_alphanum4",
    bridge_provider: "Circle",
    source_chain: "Ethereum",
    is_active: true,
  });

  await db("bridges").insert({
    name: "Circle",
    source_chain: "Ethereum",
    status: "healthy",
    total_value_locked: 1_000_000,
    supply_on_stellar: 500_000,
    supply_on_source: 500_000,
    is_active: true,
  });

  await db("bridge_operators").insert({
    bridge_id: "circle-usdc-eth",
    operator_address: "GBTEST000OPERATOR000ADDRESS000000000000000000000000000000",
    provider_name: "Circle",
    asset_code: "USDC",
    source_chain: "Ethereum",
    stake: 100_000,
    is_active: true,
    slash_count: 0,
  });

  await db("reserve_commitments").insert({
    bridge_id: "circle-usdc-eth",
    sequence: 1,
    merkle_root: "a".repeat(64),
    total_reserves: 500_000,
    committed_at: Date.now(),
    committed_ledger: 1_000_000,
    status: "pending",
  });
}
