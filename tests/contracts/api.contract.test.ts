import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.API_KEY_BOOTSTRAP_TOKEN = "bootstrap-secret";
});

import { buildServer } from "../../src/index.js";
import {
  AssetListResponseSchema,
  ContractAnnotationListResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
} from "./schemas.js";
import { assertMatchesSchema } from "./assertSchema.js";

const serviceAnnotationMocks = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
}));

vi.mock("../../src/services/serviceAnnotation.service.js", () => ({
  serviceAnnotationService: {
    create: serviceAnnotationMocks.create,
    list: serviceAnnotationMocks.list,
  },
}));

/**
 * Schema contract tests.
 *
 * These tests verify that key API endpoints keep returning responses that
 * match their documented, snapshotted shape. They are not integration tests
 * for business logic — they only ask "did the shape of this response change
 * unexpectedly?" Snapshots capture a representative payload per endpoint so
 * reviewers can see exactly what changed in a PR diff.
 *
 * Update a snapshot deliberately with `vitest run --update` and explain the
 * change in the PR description if it represents an intentional breaking change.
 */
describe("API schema contracts", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /health", () => {
    it("matches the health response contract", async () => {
      const response = await server.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
      const body = assertMatchesSchema("GET /health", JSON.parse(response.body), HealthResponseSchema);

      expect({
        status: body.status,
        version: body.version,
      }).toMatchSnapshot();
    });
  });

  describe("GET /api/v1/assets", () => {
    it("matches the asset list response contract", async () => {
      const response = await server.inject({ method: "GET", url: "/api/v1/assets" });

      expect(response.statusCode).toBe(200);
      const body = assertMatchesSchema(
        "GET /api/v1/assets",
        JSON.parse(response.body),
        AssetListResponseSchema
      );

      expect(body).toMatchSnapshot();
    });
  });

  describe("GET /api/v1/contracts/:contractAddress/annotations", () => {
    it("matches the contract annotation list response contract", async () => {
      serviceAnnotationMocks.list.mockResolvedValueOnce([
        {
          id: "ann-1",
          serviceName: "contract",
          entityType: "contract",
          entityId: "CCONTRACT123",
          content: "Audit note for schema contract test",
          author: "auditor@bridgewatch",
          startTime: null,
          endTime: null,
          active: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/contracts/CCONTRACT123/annotations",
      });

      expect(response.statusCode).toBe(200);
      const body = assertMatchesSchema(
        "GET /api/v1/contracts/:contractAddress/annotations",
        JSON.parse(response.body),
        ContractAnnotationListResponseSchema
      );

      expect(body).toMatchSnapshot();
    });

    it("matches the error response contract on invalid create", async () => {
      serviceAnnotationMocks.create.mockRejectedValueOnce(new Error("content is required"));

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/contracts/CCONTRACT123/annotations",
        payload: { author: "ops" },
      });

      expect(response.statusCode).toBe(400);
      const body = assertMatchesSchema(
        "POST /api/v1/contracts/:contractAddress/annotations (error)",
        JSON.parse(response.body),
        ErrorResponseSchema
      );

      expect(body).toMatchSnapshot();
    });
  });
});
