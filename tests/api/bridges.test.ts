import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { buildServer } from "../../src/index.js";
import type { FastifyInstance } from "fastify";

const bridgeServiceMocks = vi.hoisted(() => ({
  getAllBridgeStatuses: vi.fn(),
  getBridgeStats: vi.fn(),
}));

vi.mock("../../src/services/bridge.service.js", () => {
  return {
    BridgeService: class BridgeService {
      getAllBridgeStatuses = bridgeServiceMocks.getAllBridgeStatuses;
      getBridgeStats = bridgeServiceMocks.getBridgeStats;
    },
  };
});

describe("Bridges API", () => {
  let server: FastifyInstance;

  beforeEach(() => {
    bridgeServiceMocks.getAllBridgeStatuses.mockReset();
    bridgeServiceMocks.getBridgeStats.mockReset();

    bridgeServiceMocks.getAllBridgeStatuses.mockResolvedValue({
      bridges: [
        {
          name: "circle",
          status: "healthy",
          lastChecked: new Date("2026-01-01T00:00:00.000Z").toISOString(),
          totalValueLocked: 1000000,
          supplyOnStellar: 500000,
          supplyOnSource: 500000,
          mismatchPercentage: 0,
        },
      ],
    });

    bridgeServiceMocks.getBridgeStats.mockResolvedValue({
      name: "circle",
      totalValueLocked: 1000000,
      supplyOnStellar: 500000,
      supplyOnSource: 500000,
      status: "healthy",
      volume24h: 10000,
      volume7d: 70000,
      volume30d: 300000,
      totalTransactions: 42,
      averageTransferTime: 120,
      uptime30d: 99.9,
    });
  });

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
      expect(bridgeServiceMocks.getAllBridgeStatuses).toHaveBeenCalledTimes(1);
    });
  });

  describe("GET /api/v1/bridges/:bridge/stats", () => {
    it("should return stats for a specific bridge", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/bridges/circle/stats",
      });

      expect(response.statusCode).toBe(200);
      expect(bridgeServiceMocks.getBridgeStats).toHaveBeenCalledWith("circle");
    });
  });
});
