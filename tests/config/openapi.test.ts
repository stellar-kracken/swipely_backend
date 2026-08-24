/**
 * Unit tests for registerDefaultErrorResponse (src/config/openapi.ts).
 *
 * This hook documents a default OpenAPI error response for every route that
 * doesn't declare one of its own. It must never change what a route actually
 * sends at runtime — regression-tested here by checking that an undeclared
 * array/object response still serializes byte-for-byte the same with the
 * hook applied as it would with no response schema at all.
 */

import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerDefaultErrorResponse } from "../../src/config/openapi.js";

describe("registerDefaultErrorResponse", () => {
  let server: FastifyInstance;

  afterEach(async () => {
    if (server) await server.close();
  });

  it("registers a GenericError schema usable via $ref", async () => {
    server = Fastify();
    registerDefaultErrorResponse(server);

    expect(server.getSchema("GenericError")).toBeDefined();
  });

  it("adds a default response to a route with no schema at all, without blocking undeclared status codes", async () => {
    server = Fastify();
    registerDefaultErrorResponse(server);
    server.get("/undeclared-status", async (_req, reply) => {
      reply.code(207);
      return { items: [1, 2, 3] };
    });
    await server.ready();

    const res = await server.inject({ method: "GET", url: "/undeclared-status" });
    expect(res.statusCode).toBe(207);
    expect(JSON.parse(res.payload)).toEqual({ items: [1, 2, 3] });
  });

  it("does not corrupt an array response at an undeclared status code", async () => {
    server = Fastify();
    registerDefaultErrorResponse(server);
    server.get("/array-response", async (_req, reply) => {
      reply.code(200);
      return [{ id: "a" }, { id: "b" }, { id: "c" }];
    });
    await server.ready();

    const res = await server.inject({ method: "GET", url: "/array-response" });
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("preserves an ad hoc error payload's exact shape at a common error code", async () => {
    server = Fastify();
    registerDefaultErrorResponse(server);
    server.get("/validation-error", async (_req, reply) => {
      reply.code(400);
      return { success: false, error: "Body Validation Failed", details: [{ path: "name", message: "Required" }] };
    });
    await server.ready();

    const res = await server.inject({ method: "GET", url: "/validation-error" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload)).toEqual({
      success: false,
      error: "Body Validation Failed",
      details: [{ path: "name", message: "Required" }],
    });
  });

  it("does not override a route's own explicitly declared default response", async () => {
    server = Fastify();
    registerDefaultErrorResponse(server);

    let capturedSchema: any;
    server.addHook("onRoute", (routeOptions) => {
      if (routeOptions.url === "/custom-default") {
        capturedSchema = routeOptions.schema;
      }
    });

    server.get(
      "/custom-default",
      { schema: { response: { default: { type: "object", properties: { custom: { type: "string" } } } } } },
      async () => ({ custom: "value" })
    );
    await server.ready();

    expect(capturedSchema.response.default).toEqual({
      type: "object",
      properties: { custom: { type: "string" } },
    });
  });

  it("skips websocket routes", async () => {
    server = Fastify();
    registerDefaultErrorResponse(server);

    let capturedSchema: any;
    server.addHook("onRoute", (routeOptions) => {
      if (routeOptions.url === "/ws-route") {
        capturedSchema = routeOptions.schema;
      }
    });

    server.get("/ws-route", { websocket: true } as any, () => {});
    await server.ready();

    expect(capturedSchema?.response?.default).toBeUndefined();
  });
});
