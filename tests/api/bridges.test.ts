import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../../src/index.js";
import type { FastifyInstance } from "fastify";

describe("Bridges API", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("GET /api/v1/bridges", () => {
    it("should return a list of bridge statuses", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/bridges",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("bridges");
      expect(Array.isArray(body.bridges)).toBe(true);
    });
  });

  describe("GET /api/v1/bridges/:bridge/stats", () => {
    it("should return stats for a specific bridge", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/bridges/circle/stats",
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
