import { describe, it, expect, beforeEach } from "vitest";
import { getDatabase } from "../../../src/database/connection.js";
import { cleanDatabase } from "../../helpers/db.js";
import {
  createAsset,
  createBridge,
  createAlertRule,
  createPriceRecord,
  createHealthScore,
} from "../../factories/index.js";

describe("Database models (integration)", () => {
  beforeEach(async () => {
    await cleanDatabase(getDatabase());
  });

  // ─── Assets ──────────────────────────────────────────────────────────────

  describe("assets table", () => {
    it("inserts and retrieves an asset", async () => {
      const db = getDatabase();
      const asset = await createAsset(db, { symbol: "EURC", name: "Euro Coin" });

      const row = await db("assets").where({ id: asset.id }).first();
      expect(row).toBeDefined();
      expect(row.symbol).toBe("EURC");
      expect(row.name).toBe("Euro Coin");
    });

    it("enforces unique symbol constraint", async () => {
      const db = getDatabase();
      await createAsset(db, { symbol: "USDC" });
      await expect(createAsset(db, { symbol: "USDC" })).rejects.toThrow();
    });

    it("filters active assets correctly", async () => {
      const db = getDatabase();
      await createAsset(db, { symbol: "USDC", is_active: true });
      await createAsset(db, { symbol: "EURC", is_active: false });

      const active = await db("assets").where({ is_active: true });
      expect(active).toHaveLength(1);
      expect(active[0].symbol).toBe("USDC");
    });
  });

  // ─── Bridges ─────────────────────────────────────────────────────────────

  describe("bridges table", () => {
    it("inserts and retrieves a bridge", async () => {
      const db = getDatabase();
      const bridge = await createBridge(db, { name: "circle", status: "healthy" });

      const row = await db("bridges").where({ id: bridge.id }).first();
      expect(row).toBeDefined();
      expect(row.name).toBe("circle");
      expect(row.status).toBe("healthy");
    });

    it("updates bridge status", async () => {
      const db = getDatabase();
      const bridge = await createBridge(db, { name: "allbridge", status: "healthy" });

      await db("bridges").where({ id: bridge.id }).update({ status: "degraded" });

      const row = await db("bridges").where({ id: bridge.id }).first();
      expect(row.status).toBe("degraded");
    });

    it("stores decimal TVL with precision", async () => {
      const db = getDatabase();
      const bridge = await createBridge(db, { total_value_locked: "9999999.99" });

      const row = await db("bridges").where({ id: bridge.id }).first();
      expect(parseFloat(row.total_value_locked)).toBeCloseTo(9999999.99, 2);
    });
  });

  // ─── Alert rules ─────────────────────────────────────────────────────────

  describe("alert_rules table", () => {
    it("inserts and retrieves an alert rule", async () => {
      const db = getDatabase();
      const rule = await createAlertRule(db, { name: "My Rule", priority: "critical" });

      const row = await db("alert_rules").where({ id: rule.id }).first();
      expect(row).toBeDefined();
      expect(row.name).toBe("My Rule");
      expect(row.priority).toBe("critical");
    });

    it("stores and retrieves JSON conditions", async () => {
      const db = getDatabase();
      const conditions = [{ metric: "price_deviation", operator: "gt", threshold: 0.1 }];
      const rule = await createAlertRule(db, {
        conditions: JSON.stringify(conditions),
      });

      const row = await db("alert_rules").where({ id: rule.id }).first();
      const parsed = typeof row.conditions === "string"
        ? JSON.parse(row.conditions)
        : row.conditions;
      expect(parsed[0].metric).toBe("price_deviation");
    });

    it("toggles is_active flag", async () => {
      const db = getDatabase();
      const rule = await createAlertRule(db, { is_active: true });

      await db("alert_rules").where({ id: rule.id }).update({ is_active: false });
      const row = await db("alert_rules").where({ id: rule.id }).first();
      expect(row.is_active).toBe(false);
    });
  });

  // ─── Prices (hypertable) ──────────────────────────────────────────────────

  describe("prices table", () => {
    it("inserts and retrieves a price record", async () => {
      const db = getDatabase();
      await createPriceRecord(db, { symbol: "USDC", price: "1.00010000", source: "coinbase" });

      const rows = await db("prices").where({ symbol: "USDC" });
      expect(rows).toHaveLength(1);
      expect(parseFloat(rows[0].price)).toBeCloseTo(1.0001, 4);
    });

    it("allows multiple sources for the same symbol", async () => {
      const db = getDatabase();
      await createPriceRecord(db, { symbol: "USDC", source: "coinbase" });
      await createPriceRecord(db, { symbol: "USDC", source: "stellar_dex" });

      const rows = await db("prices").where({ symbol: "USDC" });
      expect(rows).toHaveLength(2);
      const sources = rows.map((r: any) => r.source);
      expect(sources).toContain("coinbase");
      expect(sources).toContain("stellar_dex");
    });
  });

  // ─── Health scores (hypertable) ───────────────────────────────────────────

  describe("health_scores table", () => {
    it("inserts and retrieves a health score", async () => {
      const db = getDatabase();
      await createHealthScore(db, { symbol: "USDC", overall_score: 88 });

      const rows = await db("health_scores").where({ symbol: "USDC" });
      expect(rows).toHaveLength(1);
      expect(rows[0].overall_score).toBe(88);
    });

    it("stores all component scores", async () => {
      const db = getDatabase();
      await createHealthScore(db, {
        symbol: "EURC",
        overall_score: 75,
        liquidity_depth_score: 80,
        price_stability_score: 70,
        bridge_uptime_score: 90,
        reserve_backing_score: 60,
        volume_trend_score: 75,
      });

      const row = await db("health_scores").where({ symbol: "EURC" }).first();
      expect(row.liquidity_depth_score).toBe(80);
      expect(row.reserve_backing_score).toBe(60);
    });
  });
});
