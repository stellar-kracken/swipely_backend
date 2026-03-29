import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../../src/index.js";
import { getDatabase } from "../../../src/database/connection.js";
import { cleanDatabase, truncateTables } from "../../helpers/db.js";
import { createAlertRule } from "../../factories/index.js";

describe("Alerts API (integration)", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await truncateTables(getDatabase(), ["alert_events", "alert_rules"]);
  });

  // ─── GET /api/v1/alerts/rules ───────────────────────────────────────────

  describe("GET /api/v1/alerts/rules", () => {
    it("returns 400 when owner param is missing", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/rules",
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("error");
    });

    it("returns empty array when owner has no rules", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/rules?owner=GNOTEXIST",
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.rules).toEqual([]);
    });

    it("returns rules for a given owner", async () => {
      const db = getDatabase();
      await createAlertRule(db, { owner_address: "GOWNER001" });
      await createAlertRule(db, { owner_address: "GOWNER001", name: "Second Rule" });
      await createAlertRule(db, { owner_address: "GOTHER999" });

      const res = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/rules?owner=GOWNER001",
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.rules).toHaveLength(2);
      expect(body.rules.every((r: any) => r.owner_address === "GOWNER001")).toBe(true);
    });
  });

  // ─── POST /api/v1/alerts/rules ──────────────────────────────────────────

  describe("POST /api/v1/alerts/rules", () => {
    it("creates a new alert rule and returns 201", async () => {
      const payload = {
        ownerAddress: "GCREATOR001",
        name: "Price deviation alert",
        assetCode: "USDC",
        conditions: [{ metric: "price_deviation", operator: "gt", threshold: 0.05 }],
        conditionOp: "AND",
        priority: "high",
        cooldownSeconds: 300,
      };

      const res = await server.inject({
        method: "POST",
        url: "/api/v1/alerts/rules",
        payload,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.rule).toHaveProperty("id");
      expect(body.rule.name).toBe("Price deviation alert");
      expect(body.rule.priority).toBe("high");
    });

    it("persists rule to the database", async () => {
      const payload = {
        ownerAddress: "GPERSIST001",
        name: "Persist test",
        assetCode: "EURC",
        conditions: [{ metric: "bridge_uptime", operator: "lt", threshold: 0.9 }],
        conditionOp: "AND",
        priority: "medium",
        cooldownSeconds: 60,
      };

      const res = await server.inject({
        method: "POST",
        url: "/api/v1/alerts/rules",
        payload,
      });

      expect(res.statusCode).toBe(201);
      const { rule } = JSON.parse(res.body);

      const db = getDatabase();
      const row = await db("alert_rules").where({ id: rule.id }).first();
      expect(row).toBeDefined();
      expect(row.name).toBe("Persist test");
      expect(row.asset_code).toBe("EURC");
    });
  });

  // ─── GET /api/v1/alerts/rules/:ruleId ──────────────────────────────────

  describe("GET /api/v1/alerts/rules/:ruleId", () => {
    it("returns 404 for unknown ruleId", async () => {
      const res = await server.inject({
        method: "GET",
        url: `/api/v1/alerts/rules/${crypto.randomUUID()}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns the rule when it exists", async () => {
      const db = getDatabase();
      const rule = await createAlertRule(db, { name: "Fetch me" });

      const res = await server.inject({
        method: "GET",
        url: `/api/v1/alerts/rules/${rule.id}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.rule.id).toBe(rule.id);
      expect(body.rule.name).toBe("Fetch me");
    });
  });

  // ─── PATCH /api/v1/alerts/rules/:ruleId/active ─────────────────────────

  describe("PATCH /api/v1/alerts/rules/:ruleId/active", () => {
    it("deactivates an active rule", async () => {
      const db = getDatabase();
      const rule = await createAlertRule(db, { owner_address: "GPATCH001", is_active: true });

      const res = await server.inject({
        method: "PATCH",
        url: `/api/v1/alerts/rules/${rule.id}/active`,
        payload: { ownerAddress: "GPATCH001", isActive: false },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);

      const row = await db("alert_rules").where({ id: rule.id }).first();
      expect(row.is_active).toBe(false);
    });
  });

  // ─── GET /api/v1/alerts/recent ─────────────────────────────────────────

  describe("GET /api/v1/alerts/recent", () => {
    it("returns an empty array when no events exist", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/recent",
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.events)).toBe(true);
    });
  });
});
