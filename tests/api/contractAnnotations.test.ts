import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.API_KEY_BOOTSTRAP_TOKEN = "bootstrap-secret";
});

import { buildServer } from "../../src/index.js";

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

describe("Contract Annotations API", () => {
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

  describe("POST /api/v1/contracts/:contractAddress/annotations", () => {
    it("creates an annotation scoped to the contract", async () => {
      const annotation = {
        id: "ann-1",
        serviceName: "contract",
        entityType: "contract",
        entityId: "CCONTRACT123",
        content: "Reserve threshold lowered for migration window",
        author: "ops@bridgewatch",
        startTime: null,
        endTime: null,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      serviceAnnotationMocks.create.mockResolvedValueOnce(annotation);

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/contracts/CCONTRACT123/annotations",
        payload: {
          content: "Reserve threshold lowered for migration window",
          author: "ops@bridgewatch",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(serviceAnnotationMocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "contract",
          entityId: "CCONTRACT123",
          content: "Reserve threshold lowered for migration window",
          author: "ops@bridgewatch",
        })
      );
      const body = JSON.parse(response.body);
      expect(body.entityId).toBe("CCONTRACT123");
    });

    it("returns 400 when the service rejects the input", async () => {
      serviceAnnotationMocks.create.mockRejectedValueOnce(new Error("content is required"));

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/contracts/CCONTRACT123/annotations",
        payload: { author: "ops" },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("error");
    });
  });

  describe("GET /api/v1/contracts/:contractAddress/annotations", () => {
    it("returns annotations for the given contract", async () => {
      serviceAnnotationMocks.list.mockResolvedValueOnce([
        {
          id: "ann-1",
          serviceName: "contract",
          entityType: "contract",
          entityId: "CCONTRACT123",
          content: "Audit note",
          author: "auditor@bridgewatch",
          startTime: null,
          endTime: null,
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/contracts/CCONTRACT123/annotations",
      });

      expect(response.statusCode).toBe(200);
      expect(serviceAnnotationMocks.list).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: "contract", entityId: "CCONTRACT123" })
      );
      const body = JSON.parse(response.body);
      expect(body).toHaveLength(1);
      expect(body[0].content).toBe("Audit note");
    });

    it("filters by active and author query params", async () => {
      serviceAnnotationMocks.list.mockResolvedValueOnce([]);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/contracts/CCONTRACT123/annotations?active=true&author=auditor@bridgewatch",
      });

      expect(response.statusCode).toBe(200);
      expect(serviceAnnotationMocks.list).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: "contract",
          entityId: "CCONTRACT123",
          active: true,
          author: "auditor@bridgewatch",
        })
      );
    });
  });
});
