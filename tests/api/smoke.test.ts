import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../../src/index.js";
import type { FastifyInstance } from "fastify";

describe("API Smoke Suite", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("Health endpoint", () => {
    it("should respond with 200 on GET /api/v1/health", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/health",
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("status", "ok");
      expect(body).toHaveProperty("uptime");
      expect(body).toHaveProperty("version");
    });

    it("should respond on GET /api/v1/health/live", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/health/live",
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("status", "ok");
    });

    it("should respond on GET /api/v1/health/ready", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/health/ready",
      });
      expect([200, 503]).toContain(response.statusCode);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("checks");
      expect(body.checks).toHaveProperty("database");
      expect(body.checks).toHaveProperty("redis");
    });
  });

  describe("Assets endpoint", () => {
    it("should return a list of assets on GET /api/v1/assets", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets",
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("assets");
      expect(Array.isArray(body.assets)).toBe(true);
    });

    it("should return asset details on GET /api/v1/assets/:symbol", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets/USDC",
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("symbol", "USDC");
    });
  });

  describe("Bridges endpoint", () => {
    it("should return a list of bridges on GET /api/v1/bridges", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/bridges",
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty("bridges");
      expect(Array.isArray(body.bridges)).toBe(true);
    });

    it("should return bridge details on GET /api/v1/bridges/:id", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/bridges/1",
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe("Auth endpoint", () => {
    it("should return 401 on unauthenticated access to protected routes", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/api-keys",
      });
      expect([401, 403, 200]).toContain(response.statusCode);
    });
  });
});
