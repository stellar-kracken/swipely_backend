import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AlertService,
  type AlertCondition,
  type MetricSnapshot,
} from "../../src/services/alert.service.js";

vi.mock("../../src/database/connection.js", () => {
  const store: Record<string, unknown>[] = [];
  let idCounter = 0;

  const chainable = (rows: unknown[]) => ({
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(async () => rows),
    first: vi.fn().mockImplementation(async () => rows[0] ?? null),
    insert: vi.fn().mockImplementation(async () => rows),
    update: vi.fn().mockImplementation(async () => 1),
    returning: vi.fn().mockImplementation(async () => rows),
  });

  return {
    getDatabase: vi.fn(() => ({
      __store: store,
      raw: vi.fn((sql: string) => sql),
      fn: { now: () => new Date() },
    })),
  };
});

function makeRule(overrides: Partial<ReturnType<AlertService["mapRule" & any]>> = {}) {
  return {
    id: "rule-1",
    ownerAddress: "GABC",
    name: "Test Rule",
    assetCode: "USDC",
    conditions: [
      {
        metric: "price_deviation_bps",
        alertType: "price_deviation",
        compareOp: "gt",
        threshold: 200,
      } as AlertCondition,
    ],
    conditionOp: "AND" as const,
    priority: "high" as const,
    cooldownSeconds: 0,
    isActive: true,
    webhookUrl: null,
    onChainRuleId: null,
    lastTriggeredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("AlertService — evaluateConditions (via evaluateAsset)", () => {
  let service: AlertService;

  beforeEach(() => {
    service = new AlertService();
  });

  it("fires when GT condition is exceeded", async () => {
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([makeRule()]);
    vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
    vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 350 },
    };

    const events = await service.evaluateAsset(snapshot);
    expect(events).toHaveLength(1);
    expect(events[0].triggeredValue).toBe(350);
    expect(events[0].alertType).toBe("price_deviation");
  });

  it("does not fire when value is below GT threshold", async () => {
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([makeRule()]);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 100 },
    };

    const events = await service.evaluateAsset(snapshot);
    expect(events).toHaveLength(0);
  });

  it("fires when LT condition is met", async () => {
    const rule = makeRule({
      conditions: [
        {
          metric: "health_score",
          alertType: "health_score_drop",
          compareOp: "lt",
          threshold: 50,
        } as AlertCondition,
      ],
    });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);
    vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
    vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { health_score: 30 },
    };

    const events = await service.evaluateAsset(snapshot);
    expect(events).toHaveLength(1);
    expect(events[0].alertType).toBe("health_score_drop");
  });

  it("fires when EQ condition matches", async () => {
    const rule = makeRule({
      conditions: [
        {
          metric: "bridge_uptime_pct",
          alertType: "bridge_downtime",
          compareOp: "eq",
          threshold: 0,
        } as AlertCondition,
      ],
    });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);
    vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
    vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { bridge_uptime_pct: 0 },
    };

    const events = await service.evaluateAsset(snapshot);
    expect(events).toHaveLength(1);
  });

  it("AND: both conditions must fire", async () => {
    const rule = makeRule({
      conditionOp: "AND",
      conditions: [
        {
          metric: "price_deviation_bps",
          alertType: "price_deviation",
          compareOp: "gt",
          threshold: 200,
        },
        {
          metric: "health_score",
          alertType: "health_score_drop",
          compareOp: "lt",
          threshold: 50,
        },
      ] as AlertCondition[],
    });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);

    const partialFire: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 300, health_score: 70 },
    };

    expect(await service.evaluateAsset(partialFire)).toHaveLength(0);
  });

  it("AND: fires when both conditions are true", async () => {
    const rule = makeRule({
      conditionOp: "AND",
      conditions: [
        {
          metric: "price_deviation_bps",
          alertType: "price_deviation",
          compareOp: "gt",
          threshold: 200,
        },
        {
          metric: "health_score",
          alertType: "health_score_drop",
          compareOp: "lt",
          threshold: 50,
        },
      ] as AlertCondition[],
    });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);
    vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
    vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);

    const bothFire: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 300, health_score: 30 },
    };

    expect(await service.evaluateAsset(bothFire)).toHaveLength(1);
  });

  it("OR: fires when only one condition is true", async () => {
    const rule = makeRule({
      conditionOp: "OR",
      conditions: [
        {
          metric: "price_deviation_bps",
          alertType: "price_deviation",
          compareOp: "gt",
          threshold: 200,
        },
        {
          metric: "health_score",
          alertType: "health_score_drop",
          compareOp: "lt",
          threshold: 50,
        },
      ] as AlertCondition[],
    });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);
    vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
    vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);

    const oneFire: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 300, health_score: 70 },
    };

    expect(await service.evaluateAsset(oneFire)).toHaveLength(1);
  });

  it("OR: does not fire when neither condition is true", async () => {
    const rule = makeRule({
      conditionOp: "OR",
      conditions: [
        {
          metric: "price_deviation_bps",
          alertType: "price_deviation",
          compareOp: "gt",
          threshold: 200,
        },
        {
          metric: "health_score",
          alertType: "health_score_drop",
          compareOp: "lt",
          threshold: 50,
        },
      ] as AlertCondition[],
    });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);

    const noneFire: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 50, health_score: 80 },
    };

    expect(await service.evaluateAsset(noneFire)).toHaveLength(0);
  });

  it("respects cooldown period", async () => {
    const rule = makeRule({
      cooldownSeconds: 3600,
      lastTriggeredAt: new Date(Date.now() - 60_000),
    });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 500 },
    };

    const events = await service.evaluateAsset(snapshot);
    expect(events).toHaveLength(0);
  });

  it("fires after cooldown has elapsed", async () => {
    const rule = makeRule({
      cooldownSeconds: 3600,
      lastTriggeredAt: new Date(Date.now() - 7_200_000),
    });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);
    vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
    vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 500 },
    };

    const events = await service.evaluateAsset(snapshot);
    expect(events).toHaveLength(1);
  });

  it("uses 0 for missing metric values", async () => {
    const rule = makeRule({
      conditions: [
        {
          metric: "nonexistent_metric",
          alertType: "price_deviation",
          compareOp: "gt",
          threshold: 0,
        } as AlertCondition,
      ],
    });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: {},
    };

    // 0 > 0 is false
    const events = await service.evaluateAsset(snapshot);
    expect(events).toHaveLength(0);
  });

  it("dispatches webhook when configured", async () => {
    const rule = makeRule({ webhookUrl: "https://hooks.example.com/alert" });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);
    vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
    vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);
    const webhookSpy = vi
      .spyOn(service, "dispatchWebhook")
      .mockResolvedValue(undefined);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 300 },
    };

    await service.evaluateAsset(snapshot);
    expect(webhookSpy).toHaveBeenCalledOnce();
  });

  it("does not dispatch webhook when not configured", async () => {
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([makeRule()]);
    vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
    vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);
    const webhookSpy = vi
      .spyOn(service, "dispatchWebhook")
      .mockResolvedValue(undefined);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 300 },
    };

    await service.evaluateAsset(snapshot);
    expect(webhookSpy).not.toHaveBeenCalled();
  });

  it("returns events for all assets in batchEvaluate", async () => {
    const usdcRule = makeRule({ assetCode: "USDC" });
    const eurcRule = makeRule({
      id: "rule-2",
      assetCode: "EURC",
      conditions: [
        {
          metric: "supply_mismatch_bps",
          alertType: "supply_mismatch",
          compareOp: "gt",
          threshold: 100,
        } as AlertCondition,
      ],
    });

    vi.spyOn(service, "getActiveRulesForAsset").mockImplementation(
      async (assetCode) => {
        if (assetCode === "USDC") return [usdcRule];
        if (assetCode === "EURC") return [eurcRule];
        return [];
      }
    );
    vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
    vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);

    const snapshots: MetricSnapshot[] = [
      { assetCode: "USDC", metrics: { price_deviation_bps: 300 } },
      { assetCode: "EURC", metrics: { supply_mismatch_bps: 200 } },
    ];

    const events = await service.batchEvaluate(snapshots);
    expect(events).toHaveLength(2);
    const types = events.map((e) => e.alertType);
    expect(types).toContain("price_deviation");
    expect(types).toContain("supply_mismatch");
  });

  it("handles all six alert types", async () => {
    const alertTypes = [
      { metric: "price_deviation_bps", alertType: "price_deviation" },
      { metric: "supply_mismatch_bps", alertType: "supply_mismatch" },
      { metric: "bridge_uptime_pct", alertType: "bridge_downtime" },
      { metric: "health_score", alertType: "health_score_drop" },
      { metric: "volume_zscore", alertType: "volume_anomaly" },
      { metric: "reserve_ratio_bps", alertType: "reserve_ratio_breach" },
    ] as const;

    for (const { metric, alertType } of alertTypes) {
      const rule = makeRule({
        conditions: [
          {
            metric,
            alertType,
            compareOp: "gt",
            threshold: 0,
          } as AlertCondition,
        ],
      });
      vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);
      vi.spyOn(service as any, "persistEvent").mockResolvedValue(undefined);
      vi.spyOn(service as any, "markRuleTriggered").mockResolvedValue(undefined);

      const snapshot: MetricSnapshot = {
        assetCode: "USDC",
        metrics: { [metric]: 1 },
      };

      const events = await service.evaluateAsset(snapshot);
      expect(events).toHaveLength(1);
      expect(events[0].alertType).toBe(alertType);

      vi.restoreAllMocks();
      service = new AlertService();
    }
  });

  it("returns empty array when no rules are active", async () => {
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([]);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 9999 },
    };

    const events = await service.evaluateAsset(snapshot);
    expect(events).toHaveLength(0);
  });

  it("handles empty conditions gracefully", async () => {
    const rule = makeRule({ conditions: [] });
    vi.spyOn(service, "getActiveRulesForAsset").mockResolvedValue([rule]);

    const snapshot: MetricSnapshot = {
      assetCode: "USDC",
      metrics: { price_deviation_bps: 999 },
    };

    const events = await service.evaluateAsset(snapshot);
    expect(events).toHaveLength(0);
  });
});

describe("AlertService — buildMetricSnapshot helper", () => {
  it("structures all metric keys correctly", async () => {
    const { buildMetricSnapshot } = await import(
      "../../src/workers/alertEvaluation.worker.js"
    );

    const snap = buildMetricSnapshot("USDC", {
      priceDeviationBps: 150,
      supplyMismatchBps: 50,
      bridgeUptimePct: 99,
      healthScore: 85,
      volumeZscore: 1.5,
      reserveRatioBps: 9800,
    });

    expect(snap.assetCode).toBe("USDC");
    expect(snap.metrics.price_deviation_bps).toBe(150);
    expect(snap.metrics.supply_mismatch_bps).toBe(50);
    expect(snap.metrics.bridge_uptime_pct).toBe(99);
    expect(snap.metrics.health_score).toBe(85);
    expect(snap.metrics.volume_zscore).toBe(1.5);
    expect(snap.metrics.reserve_ratio_bps).toBe(9800);
  });

  it("defaults missing fields to safe values", async () => {
    const { buildMetricSnapshot } = await import(
      "../../src/workers/alertEvaluation.worker.js"
    );

    const snap = buildMetricSnapshot("USDC", {});
    expect(snap.metrics.price_deviation_bps).toBe(0);
    expect(snap.metrics.bridge_uptime_pct).toBe(100);
    expect(snap.metrics.health_score).toBe(100);
    expect(snap.metrics.reserve_ratio_bps).toBe(10000);
  });
});
