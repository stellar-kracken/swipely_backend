import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../../src/index.js";
import { getDatabase } from "../../../src/database/connection.js";
import { truncateTables } from "../../helpers/db.js";
import { createBridge } from "../../factories/index.js";

describe("Bridges API (integration)", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await truncateTables(getDatabase(), ["bridges"]);
  });

  describe("GET /api/v1/bridges", () => {
    it("returns 200 with bridges array", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/v1/bridges",
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("bridges");
      expect(Array.isArray(body.bridges)).toBe(true);
    });

    it("reflects bridges inserted into the database", async () => {
      const db = getDatabase();
      await createBridge(db, { name: "circle", status: "healthy" });
      await createBridge(db, { name: "allbridge", source_chain: "polygon", status: "degraded" });

      const res = await server.inject({
        method: "GET",
        url: "/api/v1/bridges",
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.bridges.length).toBeGreaterThanOrEqual(2);
    });

    it("returns correct status field for each bridge", async () => {
      const db = getDatabase();
      await createBridge(db, { name: "circle", status: "healthy" });

      const res = await server.inject({
        method: "GET",
        url: "/api/v1/bridges",
      });
      const body = JSON.parse(res.body);
      const bridge = body.bridges.find((b: any) => b.name === "circle");
      expect(bridge).toBeDefined();
      expect(bridge.status).toBe("healthy");
    });
  });

  describe("GET /api/v1/bridges/:bridge/stats", () => {
    it("returns 200 for a known bridge", async () => {
      const db = getDatabase();
      await createBridge(db, { name: "circle" });

      const res = await server.inject({
        method: "GET",
        url: "/api/v1/bridges/circle/stats",
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 for an unknown bridge", async () => {
      const res = await server.inject({
        method: "GET",
        url: "/api/v1/bridges/nonexistent/stats",
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns TVL and supply fields in stats", async () => {
      const db = getDatabase();
      await createBridge(db, {
        name: "circle",
        total_value_locked: "2000000.00",
        supply_on_stellar: "1000000.00",
        supply_on_source: "1000000.00",
      });

      const res = await server.inject({
        method: "GET",
        url: "/api/v1/bridges/circle/stats",
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveProperty("totalValueLocked");
      expect(body).toHaveProperty("supplyOnStellar");
      expect(body).toHaveProperty("supplyOnSource");
    });
  });
});
