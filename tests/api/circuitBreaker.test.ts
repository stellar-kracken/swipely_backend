import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../../src/index.js";
import type { FastifyInstance } from "fastify";

describe("Circuit Breaker API", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe("GET /api/v1/circuit-breaker/status", () => {
    it("should return 400 when scope is missing", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/circuit-breaker/status",
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 400 for invalid scope", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/circuit-breaker/status?scope=invalid",
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return pause status for global scope", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/circuit-breaker/status?scope=global",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("paused");
      expect(typeof body.paused).toBe("boolean");
    });

    it("should return 400 for bridge scope without identifier", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/circuit-breaker/status?scope=bridge",
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return status for bridge scope with identifier", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/circuit-breaker/status?scope=bridge&identifier=test-bridge",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("paused");
    });
  });

  describe("GET /api/v1/circuit-breaker/whitelist", () => {
    it("should return 400 for invalid whitelist query", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/circuit-breaker/whitelist",
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /api/v1/circuit-breaker/pause", () => {
    it("should return 501 as not implemented", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/circuit-breaker/pause",
        payload: { scope: "global", reason: "test" },
      });

      expect(response.statusCode).toBe(501);
    });
  });

  describe("POST /api/v1/circuit-breaker/recovery", () => {
    it("should return 501 as not implemented", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/circuit-breaker/recovery",
        payload: { pauseId: 1 },
      });

      expect(response.statusCode).toBe(501);
    });
  });
});
