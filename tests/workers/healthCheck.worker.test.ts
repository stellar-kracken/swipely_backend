import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────
const computeAllHealthScoresMock = vi.hoisted(() => vi.fn());
const routeAlertMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const checkDedupMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({ isDuplicate: false, action: "allow" })
);
const insertHealthScoreMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/services/health.service.js", () => ({
  HealthService: class {
    computeAllHealthScores = computeAllHealthScoresMock;
  },
}));

vi.mock("../../src/services/alertRouting.service.js", () => ({
  alertRoutingService: { routeAlert: routeAlertMock },
}));

vi.mock("../../src/services/duplicateAlertCheck.service.js", () => ({
  duplicateAlertCheckService: { check: checkDedupMock },
}));

vi.mock("../../src/database/models/healthScore.model.js", () => ({
  HealthScoreModel: class {
    insert = insertHealthScoreMock;
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
    HEALTH_SCORE_THRESHOLD: 0.5,
  },
}));

import { processHealthCheckJob } from "../../src/workers/healthCheck.worker.js";

const makeScore = (symbol: string, overallScore: number, trend: "improving" | "stable" | "deteriorating") => ({
  symbol,
  overallScore,
  factors: {
    liquidityDepth: 0.8,
    priceStability: 0.8,
    bridgeUptime: 0.8,
    reserveBacking: 0.8,
    volumeTrend: 0.8,
  },
  trend,
  lastUpdated: new Date().toISOString(),
});

describe("healthCheck.worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkDedupMock.mockReturnValue({ isDuplicate: false, action: "allow" });
  });

  describe("basic job execution", () => {
    it("returns success with computed scores", async () => {
      const scores = [makeScore("USDC", 0.85, "stable")];
      computeAllHealthScoresMock.mockResolvedValue(scores);

      const result = await processHealthCheckJob({ id: "job-1" });

      expect(result.success).toBe(true);
      expect(result.scores).toHaveLength(1);
    });

    it("persists all scores regardless of trend", async () => {
      const scores = [
        makeScore("USDC", 0.85, "stable"),
        makeScore("EURC", 0.4, "deteriorating"),
        makeScore("BTC", 0.9, "improving"),
      ];
      computeAllHealthScoresMock.mockResolvedValue(scores);

      await processHealthCheckJob({ id: "job-2" });

      expect(insertHealthScoreMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("health score persistence", () => {
    it("persists correct fields to health_scores table", async () => {
      const score = makeScore("USDC", 0.85, "stable");
      computeAllHealthScoresMock.mockResolvedValue([score]);

      await processHealthCheckJob({ id: "job-3" });

      expect(insertHealthScoreMock).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: "USDC",
          overall_score: 0.85,
          liquidity_depth_score: 0.8,
          price_stability_score: 0.8,
          bridge_uptime_score: 0.8,
          reserve_backing_score: 0.8,
          volume_trend_score: 0.8,
        })
      );
    });

    it("continues processing other scores when one insert fails", async () => {
      const scores = [makeScore("USDC", 0.85, "stable"), makeScore("EURC", 0.9, "stable")];
      computeAllHealthScoresMock.mockResolvedValue(scores);
      insertHealthScoreMock.mockRejectedValueOnce(new Error("DB timeout"));

      const result = await processHealthCheckJob({ id: "job-4" });

      expect(result.success).toBe(true);
      expect(insertHealthScoreMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("deteriorating trend alerting", () => {
    it("routes alert only for deteriorating scores", async () => {
      const scores = [
        makeScore("USDC", 0.85, "stable"),
        makeScore("EURC", 0.4, "deteriorating"),
        makeScore("BTC", 0.9, "improving"),
      ];
      computeAllHealthScoresMock.mockResolvedValue(scores);

      await processHealthCheckJob({ id: "job-5" });

      expect(routeAlertMock).toHaveBeenCalledOnce();
      expect(routeAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ assetCode: "EURC" })
      );
    });

    it("does not route any alert when no scores are deteriorating", async () => {
      computeAllHealthScoresMock.mockResolvedValue([
        makeScore("USDC", 0.85, "stable"),
        makeScore("EURC", 0.95, "improving"),
      ]);

      await processHealthCheckJob({ id: "job-6" });

      expect(routeAlertMock).not.toHaveBeenCalled();
    });

    it("assigns critical severity when overallScore is below 0.3", async () => {
      computeAllHealthScoresMock.mockResolvedValue([makeScore("USDC", 0.2, "deteriorating")]);

      await processHealthCheckJob({ id: "job-7" });

      expect(routeAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "critical", assetCode: "USDC" })
      );
    });

    it("assigns high severity when overallScore is between 0.3 and threshold", async () => {
      computeAllHealthScoresMock.mockResolvedValue([makeScore("EURC", 0.4, "deteriorating")]);

      await processHealthCheckJob({ id: "job-8" });

      expect(routeAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ severity: "high", assetCode: "EURC" })
      );
    });
  });

  describe("error propagation", () => {
    it("throws when computeAllHealthScores fails", async () => {
      computeAllHealthScoresMock.mockRejectedValueOnce(new Error("health service down"));

      await expect(processHealthCheckJob({ id: "job-err" })).rejects.toThrow("health service down");
    });

    it("does not persist or alert when health service fails", async () => {
      computeAllHealthScoresMock.mockRejectedValueOnce(new Error("timeout"));

      await expect(processHealthCheckJob({ id: "job-err2" })).rejects.toThrow();

      expect(insertHealthScoreMock).not.toHaveBeenCalled();
      expect(routeAlertMock).not.toHaveBeenCalled();
    });
  });

  describe("deduplication", () => {
    it("suppresses alert when dedup check blocks", async () => {
      computeAllHealthScoresMock.mockResolvedValue([makeScore("USDC", 0.4, "deteriorating")]);
      checkDedupMock.mockReturnValue({ isDuplicate: true, action: "block", reason: "within window" });

      await processHealthCheckJob({ id: "job-9" });

      expect(routeAlertMock).not.toHaveBeenCalled();
    });

    it("allows alert when dedup action is escalate", async () => {
      computeAllHealthScoresMock.mockResolvedValue([makeScore("USDC", 0.4, "deteriorating")]);
      checkDedupMock.mockReturnValue({ isDuplicate: true, action: "escalate" });

      await processHealthCheckJob({ id: "job-10" });

      expect(routeAlertMock).toHaveBeenCalledOnce();
    });

    it("routes one alert per deteriorating asset", async () => {
      computeAllHealthScoresMock.mockResolvedValue([
        makeScore("USDC", 0.4, "deteriorating"),
        makeScore("EURC", 0.35, "deteriorating"),
      ]);

      await processHealthCheckJob({ id: "job-multi" });

      expect(routeAlertMock).toHaveBeenCalledTimes(2);
      const symbols = routeAlertMock.mock.calls.map((c) => c[0].assetCode);
      expect(symbols).toContain("USDC");
      expect(symbols).toContain("EURC");
    });

    it("passes matching ruleId to both dedup check and alert routing", async () => {
      computeAllHealthScoresMock.mockResolvedValue([makeScore("EURC", 0.4, "deteriorating")]);

      await processHealthCheckJob({ id: "job-11" });

      const dedupCall = checkDedupMock.mock.calls[0][0];
      const alertCall = routeAlertMock.mock.calls[0][0];
      expect(dedupCall.ruleId).toBe("health-check-EURC");
      expect(alertCall.alertRuleId).toBe("health-check-EURC");
    });
  });
});
