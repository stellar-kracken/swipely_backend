import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../../src/index.js";
import type { FastifyInstance } from "fastify";

describe("Assets API", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("GET /api/v1/assets", () => {
    it("should return a list of monitored assets", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("assets");
      expect(Array.isArray(body.assets)).toBe(true);
    });
  });

  describe("GET /api/v1/assets/:symbol", () => {
    it("should return asset details for a given symbol", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets/USDC",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("symbol", "USDC");
    });
  });

  describe("GET /api/v1/assets/:symbol/health", () => {
    it("should return health score for an asset", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets/USDC/health",
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("GET /api/v1/assets/:symbol/liquidity", () => {
    it("should return liquidity data for an asset", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets/USDC/liquidity",
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("GET /api/v1/assets/:symbol/price", () => {
    it("should return aggregated price data for an asset", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets/USDC/price",
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
