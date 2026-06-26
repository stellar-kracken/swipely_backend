import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
const getAggregatedPriceMock = vi.hoisted(() => vi.fn());
const checkDeviationMock = vi.hoisted(() => vi.fn().mockResolvedValue({ deviated: false, percentage: 0 }));
const routeAlertMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const checkDedupMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({ isDuplicate: false, action: "allow" })
);
const insertBatchMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/services/price.service.js", () => ({
  PriceService: class {
    getAggregatedPrice = getAggregatedPriceMock;
    checkDeviation = checkDeviationMock;
  },
}));

vi.mock("../../src/services/alertRouting.service.js", () => ({
  alertRoutingService: { routeAlert: routeAlertMock },
}));

vi.mock("../../src/services/duplicateAlertCheck.service.js", () => ({
  duplicateAlertCheckService: { check: checkDedupMock },
}));

vi.mock("../../src/database/models/price.model.js", () => ({
  PriceModel: class {
    insertBatch = insertBatchMock;
  },
}));

vi.mock("bullmq", () => ({
  Worker: class {
    on() {}
  },
  Queue: class {
    add = vi.fn().mockResolvedValue({ id: "mock-job" });
    on() {}
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    REDIS_HOST: "localhost",
    REDIS_PORT: 6379,
    PRICE_DEVIATION_THRESHOLD: 0.02,
  },
}));

import { processPriceAggregatorJob } from "../../src/workers/priceAggregator.worker.js";

const makeAggregated = (symbol: string, sources = [{ source: "sdex", price: 1.001, timestamp: new Date().toISOString() }]) => ({
  symbol,
  vwap: 1.0,
  sources,
  deviation: 0.001,
  lastUpdated: new Date().toISOString(),
});

describe("priceAggregator.worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkDedupMock.mockReturnValue({ isDuplicate: false, action: "allow" });
    checkDeviationMock.mockResolvedValue({ deviated: false, percentage: 0 });
  });

  describe("basic job execution", () => {
    it("returns success with aggregated price", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));

      const result = await processPriceAggregatorJob({ id: "job-1", data: { symbol: "USDC" } });

      expect(result.success).toBe(true);
      expect(result.symbol).toBe("USDC");
    });

    it("returns success even when aggregatedPrice is null", async () => {
      getAggregatedPriceMock.mockResolvedValue(null);

      const result = await processPriceAggregatorJob({ id: "job-2", data: { symbol: "USDC" } });

      expect(result.success).toBe(true);
      expect(result.price).toBeNull();
    });
  });

  describe("price persistence", () => {
    it("batch-inserts source prices into TimescaleDB when aggregatedPrice is present", async () => {
      const sources = [
        { source: "sdex", price: 1.001, timestamp: new Date().toISOString() },
        { source: "circle", price: 1.0, timestamp: new Date().toISOString() },
      ];
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC", sources));

      await processPriceAggregatorJob({ id: "job-3", data: { symbol: "USDC" } });

      expect(insertBatchMock).toHaveBeenCalledOnce();
      const records = insertBatchMock.mock.calls[0][0];
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ symbol: "USDC", source: "sdex", price: 1.001 });
      expect(records[1]).toMatchObject({ symbol: "USDC", source: "circle", price: 1.0 });
    });

    it("sets volume_24h to null on each persisted record", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));

      await processPriceAggregatorJob({ id: "job-vol", data: { symbol: "USDC" } });

      const records = insertBatchMock.mock.calls[0][0];
      expect(records.every((r: any) => r.volume_24h === null)).toBe(true);
    });

    it("skips persistence when aggregatedPrice is null", async () => {
      getAggregatedPriceMock.mockResolvedValue(null);

      await processPriceAggregatorJob({ id: "job-4", data: { symbol: "USDC" } });

      expect(insertBatchMock).not.toHaveBeenCalled();
    });

    it("continues and returns success when batch insert fails", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));
      insertBatchMock.mockRejectedValueOnce(new Error("DB timeout"));

      const result = await processPriceAggregatorJob({ id: "job-5", data: { symbol: "USDC" } });

      expect(result.success).toBe(true);
    });
  });

  describe("deviation alerting", () => {
    it("does not route alert when no deviation", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));
      checkDeviationMock.mockResolvedValue({ deviated: false, percentage: 0 });

      await processPriceAggregatorJob({ id: "job-6", data: { symbol: "USDC" } });

      expect(routeAlertMock).not.toHaveBeenCalled();
    });

    it("routes alert when deviation is detected and not duplicate", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));
      checkDeviationMock.mockResolvedValue({ deviated: true, percentage: 0.03 });

      await processPriceAggregatorJob({ id: "job-7", data: { symbol: "USDC" } });

      expect(routeAlertMock).toHaveBeenCalledOnce();
      expect(routeAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          assetCode: "USDC",
          sourceType: "price_deviation",
          triggeredValue: 0.03,
        })
      );
    });

    it("assigns critical severity when deviation exceeds 2x threshold", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));
      checkDeviationMock.mockResolvedValue({ deviated: true, percentage: 0.05 });

      await processPriceAggregatorJob({ id: "job-8", data: { symbol: "USDC" } });

      expect(routeAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "critical" })
      );
    });

    it("assigns high severity when deviation is above threshold but below 2x", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));
      checkDeviationMock.mockResolvedValue({ deviated: true, percentage: 0.03 });

      await processPriceAggregatorJob({ id: "job-9", data: { symbol: "USDC" } });

      expect(routeAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "high" })
      );
    });
  });

  describe("alert and persistence in same job", () => {
    it("both routes alert and persists prices when deviation detected", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));
      checkDeviationMock.mockResolvedValue({ deviated: true, percentage: 0.03 });

      await processPriceAggregatorJob({ id: "job-both", data: { symbol: "USDC" } });

      expect(routeAlertMock).toHaveBeenCalledOnce();
      expect(insertBatchMock).toHaveBeenCalledOnce();
    });
  });

  describe("deduplication", () => {
    it("suppresses alert when dedup check blocks", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));
      checkDeviationMock.mockResolvedValue({ deviated: true, percentage: 0.03 });
      checkDedupMock.mockReturnValue({ isDuplicate: true, action: "block", reason: "within window" });

      await processPriceAggregatorJob({ id: "job-10", data: { symbol: "USDC" } });

      expect(routeAlertMock).not.toHaveBeenCalled();
    });

    it("allows alert when dedup action is escalate", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("USDC"));
      checkDeviationMock.mockResolvedValue({ deviated: true, percentage: 0.03 });
      checkDedupMock.mockReturnValue({ isDuplicate: true, action: "escalate" });

      await processPriceAggregatorJob({ id: "job-11", data: { symbol: "USDC" } });

      expect(routeAlertMock).toHaveBeenCalledOnce();
    });

    it("passes consistent ruleId to dedup check and alertRuleId to alert routing", async () => {
      getAggregatedPriceMock.mockResolvedValue(makeAggregated("EURC"));
      checkDeviationMock.mockResolvedValue({ deviated: true, percentage: 0.03 });

      await processPriceAggregatorJob({ id: "job-12", data: { symbol: "EURC" } });

      const dedupCall = checkDedupMock.mock.calls[0][0];
      const alertCall = routeAlertMock.mock.calls[0][0];
      expect(dedupCall.ruleId).toBe("price-aggregator-EURC");
      expect(alertCall.alertRuleId).toBe("price-aggregator-EURC");
    });
  });
});
