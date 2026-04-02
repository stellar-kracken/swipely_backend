import type { Knex } from "knex";
import { randomUUID } from "crypto";

// ─── Asset factory ────────────────────────────────────────────────────────────

export async function createAsset(db: Knex, overrides: Record<string, unknown> = {}) {
  const asset = {
    id: randomUUID(),
    symbol: "USDC",
    name: "USD Coin",
    issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    asset_type: "credit_alphanum4",
    bridge_provider: "circle",
    source_chain: "ethereum",
    is_active: true,
    ...overrides,
  };
  await db("assets").insert(asset);
  return asset;
}

// ─── Bridge factory ───────────────────────────────────────────────────────────

export async function createBridge(db: Knex, overrides: Record<string, unknown> = {}) {
  const bridge = {
    id: randomUUID(),
    name: "circle",
    source_chain: "ethereum",
    status: "healthy",
    total_value_locked: "1000000.00",
    supply_on_stellar: "500000.00",
    supply_on_source: "500000.00",
    is_active: true,
    ...overrides,
  };
  await db("bridges").insert(bridge);
  return bridge;
}

// ─── Alert rule factory ───────────────────────────────────────────────────────

export async function createAlertRule(db: Knex, overrides: Record<string, unknown> = {}) {
  const rule = {
    id: randomUUID(),
    owner_address: "GTEST123456789",
    name: "Test Alert Rule",
    asset_code: "USDC",
    conditions: JSON.stringify([
      { metric: "price_deviation", operator: "gt", threshold: 0.05 },
    ]),
    condition_op: "AND",
    priority: "medium",
    cooldown_seconds: 300,
    is_active: true,
    webhook_url: null,
    on_chain_rule_id: null,
    last_triggered_at: null,
    ...overrides,
  };
  await db("alert_rules").insert(rule);
  return rule;
}

// ─── Price record factory ─────────────────────────────────────────────────────

export async function createPriceRecord(db: Knex, overrides: Record<string, unknown> = {}) {
  const record = {
    time: new Date(),
    symbol: "USDC",
    source: "coinbase",
    price: "1.00000000",
    volume_24h: "1000000.00",
    ...overrides,
  };
  await db("prices").insert(record);
  return record;
}

// ─── Health score factory ─────────────────────────────────────────────────────

export async function createHealthScore(db: Knex, overrides: Record<string, unknown> = {}) {
  const record = {
    time: new Date(),
    symbol: "USDC",
    overall_score: 95,
    liquidity_depth_score: 100,
    price_stability_score: 90,
    bridge_uptime_score: 100,
    reserve_backing_score: 95,
    volume_trend_score: 90,
    ...overrides,
  };
  await db("health_scores").insert(record);
  return record;
}
