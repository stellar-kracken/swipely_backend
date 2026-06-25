/**
 * Integration tests verifying the fixture system itself — Issue #651
 *
 * These tests confirm that:
 *  - Each fixture loads its expected rows deterministically
 *  - resetFixture truncates all managed tables cleanly
 *  - Fixtures can be swapped between tests without leakage
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDatabase, closeDatabase } from "../../../src/database/connection.js";
import { resetDatabase } from "../../helpers/db.js";
import { Fixture, loadFixture, resetFixture, listLoadedFixtures } from "../../fixtures/index.js";
import type { Knex } from "knex";

let db: Knex;

beforeAll(async () => {
  db = getDatabase();
  await resetDatabase(db);
});

afterAll(async () => {
  await closeDatabase();
});

afterEach(async () => {
  await resetFixture(db);
});

// ─── MinimalAsset ─────────────────────────────────────────────────────────────

describe("Fixture.MinimalAsset", () => {
  beforeEach(() => loadFixture(db, Fixture.MinimalAsset));

  it("inserts exactly one asset (XLM)", async () => {
    const rows = await db("assets").select("*");
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("XLM");
    expect(rows[0].asset_type).toBe("native");
  });

  it("inserts no bridges", async () => {
    const rows = await db("bridges").select("*");
    expect(rows).toHaveLength(0);
  });
});

// ─── HealthyBridge ────────────────────────────────────────────────────────────

describe("Fixture.HealthyBridge", () => {
  beforeEach(() => loadFixture(db, Fixture.HealthyBridge));

  it("inserts one bridge with status=healthy", async () => {
    const rows = await db("bridges").select("*");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("healthy");
    expect(rows[0].name).toBe("Circle");
  });

  it("supply_on_stellar equals supply_on_source (no mismatch)", async () => {
    const [bridge] = await db("bridges").select("*");
    expect(Number(bridge.supply_on_stellar)).toBe(Number(bridge.supply_on_source));
  });
});

// ─── DegradedBridge ───────────────────────────────────────────────────────────

describe("Fixture.DegradedBridge", () => {
  beforeEach(() => loadFixture(db, Fixture.DegradedBridge));

  it("inserts one bridge with status=degraded", async () => {
    const [bridge] = await db("bridges").select("*");
    expect(bridge.status).toBe("degraded");
  });

  it("supply_on_stellar is ~15% higher than supply_on_source", async () => {
    const [bridge] = await db("bridges").select("*");
    const stellar = Number(bridge.supply_on_stellar);
    const source = Number(bridge.supply_on_source);
    const mismatch = (stellar - source) / source;
    expect(mismatch).toBeCloseTo(0.15, 1);
  });
});

// ─── MixedBridgeHealth ────────────────────────────────────────────────────────

describe("Fixture.MixedBridgeHealth", () => {
  beforeEach(() => loadFixture(db, Fixture.MixedBridgeHealth));

  it("inserts two bridges with different statuses", async () => {
    const rows = await db("bridges").select("status").orderBy("name");
    const statuses = rows.map((r: { status: string }) => r.status);
    expect(statuses).toContain("healthy");
    expect(statuses).toContain("down");
  });

  it("inserts two assets", async () => {
    const rows = await db("assets").select("symbol");
    expect(rows).toHaveLength(2);
  });
});

// ─── MultiAsset ───────────────────────────────────────────────────────────────

describe("Fixture.MultiAsset", () => {
  beforeEach(() => loadFixture(db, Fixture.MultiAsset));

  it("inserts XLM, USDC, and EURC", async () => {
    const rows = await db("assets").select("symbol").orderBy("symbol");
    const symbols = rows.map((r: { symbol: string }) => r.symbol);
    expect(symbols).toContain("XLM");
    expect(symbols).toContain("USDC");
    expect(symbols).toContain("EURC");
  });

  it("XLM has no bridge_provider (native asset)", async () => {
    const [xlm] = await db("assets").where("symbol", "XLM").select("bridge_provider");
    expect(xlm.bridge_provider).toBeNull();
  });
});

// ─── PendingReserveCommitment ─────────────────────────────────────────────────

describe("Fixture.PendingReserveCommitment", () => {
  beforeEach(() => loadFixture(db, Fixture.PendingReserveCommitment));

  it("inserts a reserve commitment with status=pending", async () => {
    const rows = await db("reserve_commitments").select("*");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].sequence).toBe(1);
  });

  it("inserts a bridge operator linked to the commitment", async () => {
    const rows = await db("bridge_operators").select("*");
    expect(rows).toHaveLength(1);
    expect(rows[0].bridge_id).toBe("circle-usdc-eth");
  });
});

// ─── VerifiedReserveCommitment ────────────────────────────────────────────────

describe("Fixture.VerifiedReserveCommitment", () => {
  beforeEach(() => loadFixture(db, Fixture.VerifiedReserveCommitment));

  it("inserts a reserve commitment with status=verified", async () => {
    const [commitment] = await db("reserve_commitments").select("*");
    expect(commitment.status).toBe("verified");
  });

  it("committed_at is in the past", async () => {
    const [commitment] = await db("reserve_commitments").select("committed_at");
    expect(Number(commitment.committed_at)).toBeLessThan(Date.now());
  });
});

// ─── Fixture isolation ────────────────────────────────────────────────────────

describe("Fixture isolation (no cross-test leakage)", () => {
  it("tables are empty after resetFixture", async () => {
    await loadFixture(db, Fixture.HealthyBridge);
    await resetFixture(db);

    const bridges = await db("bridges").select("*");
    const assets = await db("assets").select("*");
    expect(bridges).toHaveLength(0);
    expect(assets).toHaveLength(0);
  });

  it("loading a second fixture does not accumulate rows from the first", async () => {
    await loadFixture(db, Fixture.HealthyBridge);
    await loadFixture(db, Fixture.MinimalAsset); // implicitly resets before loading

    const bridges = await db("bridges").select("*");
    const assets = await db("assets").select("*");
    expect(bridges).toHaveLength(0);
    expect(assets).toHaveLength(1);
    expect(assets[0].symbol).toBe("XLM");
  });

  it("listLoadedFixtures returns the current fixture name", async () => {
    await loadFixture(db, Fixture.MultiAsset);
    expect(listLoadedFixtures()).toBe(Fixture.MultiAsset);
  });

  it("listLoadedFixtures returns null after reset", async () => {
    await loadFixture(db, Fixture.HealthyBridge);
    await resetFixture(db);
    expect(listLoadedFixtures()).toBeNull();
  });
});
