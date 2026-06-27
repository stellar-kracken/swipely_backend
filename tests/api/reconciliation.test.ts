import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.API_KEY_BOOTSTRAP_TOKEN = "bootstrap-secret";
});

import { buildServer } from "../../src/index.js";

// The route does `new ReconciliationService()`, so mock the constructor to
// return an object backed by shared spies.
const reconMocks = vi.hoisted(() => ({
  getDriftSummaries: vi.fn(),
  listRuns: vi.fn(),
  getMismatchDetail: vi.fn(),
  updateTriageStatus: vi.fn(),
  getLatestRun: vi.fn(),
}));

vi.mock("../../src/services/reconciliation.service.js", () => ({
  ReconciliationService: vi.fn(() => ({
    getDriftSummaries: reconMocks.getDriftSummaries,
    listRuns: reconMocks.listRuns,
    getMismatchDetail: reconMocks.getMismatchDetail,
    updateTriageStatus: reconMocks.updateTriageStatus,
    getLatestRun: reconMocks.getLatestRun,
  })),
}));

const BASE = "/api/v1/reconciliation";
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("Reconciliation API", () => {
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

  describe("GET /runs", () => {
    it("returns the reconciliation runs", async () => {
      const runs = [
        { id: VALID_UUID, assetCode: "USDC", status: "completed", drift: "0" },
      ];
      reconMocks.listRuns.mockResolvedValueOnce(runs);

      const response = await server.inject({ method: "GET", url: `${BASE}/runs` });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ runs });
      expect(reconMocks.listRuns).toHaveBeenCalledTimes(1);
    });

    it("forwards assetCode and limit query params to the service", async () => {
      reconMocks.listRuns.mockResolvedValueOnce([]);

      const response = await server.inject({
        method: "GET",
        url: `${BASE}/runs?assetCode=USDC&limit=10`,
      });

      expect(response.statusCode).toBe(200);
      expect(reconMocks.listRuns).toHaveBeenCalledWith(
        expect.objectContaining({ assetCode: "USDC", limit: 10 }),
      );
    });

    it("returns 400 for an invalid limit", async () => {
      const response = await server.inject({
        method: "GET",
        url: `${BASE}/runs?limit=-5`,
      });
      expect(response.statusCode).toBe(400);
      expect(reconMocks.listRuns).not.toHaveBeenCalled();
    });

    it("returns 500 when the service throws", async () => {
      reconMocks.listRuns.mockRejectedValueOnce(new Error("db down"));

      const response = await server.inject({ method: "GET", url: `${BASE}/runs` });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toHaveProperty("error");
    });
  });

  describe("GET /drift-summaries", () => {
    it("returns drift summary results", async () => {
      const summaries = [
        { assetCode: "USDC", bridge: "Circle", drift: "1200.5", direction: "surplus" },
      ];
      reconMocks.getDriftSummaries.mockResolvedValueOnce(summaries);

      const response = await server.inject({
        method: "GET",
        url: `${BASE}/drift-summaries?assetCode=USDC&range=7d`,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(summaries);
      expect(reconMocks.getDriftSummaries).toHaveBeenCalledWith(
        expect.objectContaining({ assetCode: "USDC", range: "7d" }),
      );
    });

    it("returns 400 for an invalid range", async () => {
      const response = await server.inject({
        method: "GET",
        url: `${BASE}/drift-summaries?range=99h`,
      });
      expect(response.statusCode).toBe(400);
      expect(reconMocks.getDriftSummaries).not.toHaveBeenCalled();
    });

    it("returns 500 when the service throws", async () => {
      reconMocks.getDriftSummaries.mockRejectedValueOnce(new Error("boom"));

      const response = await server.inject({
        method: "GET",
        url: `${BASE}/drift-summaries`,
      });
      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /latest/:assetCode", () => {
    it("returns the latest run for an asset", async () => {
      const run = { id: VALID_UUID, assetCode: "USDC", status: "completed" };
      reconMocks.getLatestRun.mockResolvedValueOnce(run);

      const response = await server.inject({
        method: "GET",
        url: `${BASE}/latest/USDC`,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ run });
      expect(reconMocks.getLatestRun).toHaveBeenCalledWith("USDC");
    });

    it("returns 404 when no run exists", async () => {
      reconMocks.getLatestRun.mockResolvedValueOnce(null);

      const response = await server.inject({
        method: "GET",
        url: `${BASE}/latest/EURC`,
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns 500 when the service throws", async () => {
      reconMocks.getLatestRun.mockRejectedValueOnce(new Error("nope"));

      const response = await server.inject({
        method: "GET",
        url: `${BASE}/latest/USDC`,
      });
      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /mismatches/:id", () => {
    it("returns 400 for a non-UUID id", async () => {
      const response = await server.inject({
        method: "GET",
        url: `${BASE}/mismatches/not-a-uuid`,
      });
      expect(response.statusCode).toBe(400);
      expect(reconMocks.getMismatchDetail).not.toHaveBeenCalled();
    });

    it("returns 404 when the mismatch is not found", async () => {
      reconMocks.getMismatchDetail.mockResolvedValueOnce(null);

      const response = await server.inject({
        method: "GET",
        url: `${BASE}/mismatches/${VALID_UUID}`,
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns the mismatch detail when found", async () => {
      const detail = { id: VALID_UUID, assetCode: "USDC", expected: "100", actual: "98" };
      reconMocks.getMismatchDetail.mockResolvedValueOnce(detail);

      const response = await server.inject({
        method: "GET",
        url: `${BASE}/mismatches/${VALID_UUID}?range=24h`,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(detail);
      expect(reconMocks.getMismatchDetail).toHaveBeenCalledWith(
        VALID_UUID,
        expect.objectContaining({ range: "24h" }),
      );
    });
  });

  describe("PATCH /runs/:id/triage", () => {
    it("updates the triage status of a run", async () => {
      const run = { id: VALID_UUID, triageStatus: "investigating" };
      reconMocks.updateTriageStatus.mockResolvedValueOnce(run);

      const response = await server.inject({
        method: "PATCH",
        url: `${BASE}/runs/${VALID_UUID}/triage`,
        payload: { status: "investigating", owner: "ops@bridgewatch" },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ run });
      expect(reconMocks.updateTriageStatus).toHaveBeenCalledWith(
        VALID_UUID,
        expect.objectContaining({ status: "investigating", owner: "ops@bridgewatch" }),
      );
    });

    it("returns 400 for an invalid status value", async () => {
      const response = await server.inject({
        method: "PATCH",
        url: `${BASE}/runs/${VALID_UUID}/triage`,
        payload: { status: "not-a-status" },
      });
      expect(response.statusCode).toBe(400);
      expect(reconMocks.updateTriageStatus).not.toHaveBeenCalled();
    });

    it("returns 404 when the run does not exist", async () => {
      reconMocks.updateTriageStatus.mockResolvedValueOnce(null);

      const response = await server.inject({
        method: "PATCH",
        url: `${BASE}/runs/${VALID_UUID}/triage`,
        payload: { status: "resolved" },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
