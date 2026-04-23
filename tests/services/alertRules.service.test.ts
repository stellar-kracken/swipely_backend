import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AlertRulesService,
  type AlertRule,
  type RuleCondition,
  type TimeWindow,
} from "../../src/services/alertRules.service.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const b: Record<string, unknown> = {};
    b.where = vi.fn().mockReturnValue(b);
    b.orderBy = vi.fn().mockReturnValue(b);
    b.insert = vi.fn().mockReturnValue(b);
    b.update = vi.fn().mockResolvedValue(1);
    b.delete = vi.fn().mockResolvedValue(1);
    b.first = vi.fn().mockResolvedValue(null);
    b.returning = vi.fn().mockResolvedValue([]);
    b.raw = vi.fn((s: string) => s);
    const fn = (_t: string) => b;
    fn.raw = vi.fn((s: string) => s);
    return fn;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "rule-1",
    ownerAddress: "GABC",
    name: "Test",
    description: null,
    assetCode: "USDC",
    conditions: [{ metric: "health_score", operator: "lt", threshold: 70 }],
    logicOperator: "AND",
    priority: "medium",
    status: "active",
    cooldownSeconds: 3600,
    timeWindow: null,
    version: 1,
    templateId: null,
    webhookUrl: null,
    lastTriggeredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — evaluation engine (pure logic, no DB)
// ---------------------------------------------------------------------------

describe("AlertRulesService — evaluateRule operators", () => {
  let service: AlertRulesService;

  beforeEach(() => {
    (AlertRulesService as any).instance = undefined;
    service = AlertRulesService.getInstance();
  });

  it("gt: triggers when value > threshold", () => {
    const rule = makeRule({ conditions: [{ metric: "m", operator: "gt", threshold: 100 }] });
    expect(service.evaluateRule(rule, { m: 101 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { m: 100 }).triggered).toBe(false);
  });

  it("gte: triggers when value >= threshold", () => {
    const rule = makeRule({ conditions: [{ metric: "m", operator: "gte", threshold: 100 }] });
    expect(service.evaluateRule(rule, { m: 100 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { m: 99 }).triggered).toBe(false);
  });

  it("lt: triggers when value < threshold", () => {
    const rule = makeRule({ conditions: [{ metric: "m", operator: "lt", threshold: 70 }] });
    expect(service.evaluateRule(rule, { m: 69 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { m: 70 }).triggered).toBe(false);
  });

  it("lte: triggers when value <= threshold", () => {
    const rule = makeRule({ conditions: [{ metric: "m", operator: "lte", threshold: 70 }] });
    expect(service.evaluateRule(rule, { m: 70 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { m: 71 }).triggered).toBe(false);
  });

  it("eq: triggers on exact match", () => {
    const rule = makeRule({ conditions: [{ metric: "m", operator: "eq", threshold: 42 }] });
    expect(service.evaluateRule(rule, { m: 42 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { m: 43 }).triggered).toBe(false);
  });

  it("ne: triggers when values differ", () => {
    const rule = makeRule({ conditions: [{ metric: "m", operator: "ne", threshold: 42 }] });
    expect(service.evaluateRule(rule, { m: 43 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { m: 42 }).triggered).toBe(false);
  });

  it("between: triggers when value is within [low, high]", () => {
    const rule = makeRule({
      conditions: [{ metric: "m", operator: "between", threshold: 10, thresholdHigh: 20 }],
    });
    expect(service.evaluateRule(rule, { m: 15 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { m: 10 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { m: 20 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { m: 21 }).triggered).toBe(false);
  });

  it("changes_by_pct: triggers on sufficient % change", () => {
    const rule = makeRule({
      conditions: [{ metric: "vol", operator: "changes_by_pct", threshold: 50 }],
    });
    // 100 → 160 is 60% change — triggers
    expect(service.evaluateRule(rule, { vol: 160 }, { vol: 100 }).triggered).toBe(true);
    // 100 → 130 is 30% change — does not trigger
    expect(service.evaluateRule(rule, { vol: 130 }, { vol: 100 }).triggered).toBe(false);
    // No previous value — should not trigger
    expect(service.evaluateRule(rule, { vol: 999 }).triggered).toBe(false);
  });
});

describe("AlertRulesService — AND vs OR logic", () => {
  let service: AlertRulesService;

  beforeEach(() => {
    (AlertRulesService as any).instance = undefined;
    service = AlertRulesService.getInstance();
  });

  const conditions: RuleCondition[] = [
    { metric: "a", operator: "gt", threshold: 10 },
    { metric: "b", operator: "gt", threshold: 20 },
  ];

  it("AND: triggers only when all conditions pass", () => {
    const rule = makeRule({ conditions, logicOperator: "AND" });
    expect(service.evaluateRule(rule, { a: 11, b: 21 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { a: 11, b: 15 }).triggered).toBe(false);
    expect(service.evaluateRule(rule, { a: 5, b: 21 }).triggered).toBe(false);
  });

  it("OR: triggers when at least one condition passes", () => {
    const rule = makeRule({ conditions, logicOperator: "OR" });
    expect(service.evaluateRule(rule, { a: 11, b: 5 }).triggered).toBe(true);
    expect(service.evaluateRule(rule, { a: 5, b: 5 }).triggered).toBe(false);
  });
});

describe("AlertRulesService — time window", () => {
  let service: AlertRulesService;

  beforeEach(() => {
    (AlertRulesService as any).instance = undefined;
    service = AlertRulesService.getInstance();
  });

  it("rule with null time window always fires", () => {
    const rule = makeRule({ timeWindow: null });
    expect(service.evaluateRule(rule, { health_score: 50 }).timeWindowActive).toBe(true);
  });

  it("result includes timeWindowActive field", () => {
    const rule = makeRule({
      timeWindow: { startHour: 0, endHour: 23 },
    });
    const result = service.evaluateRule(rule, { health_score: 50 });
    expect(typeof result.timeWindowActive).toBe("boolean");
  });
});

describe("AlertRulesService — test mode", () => {
  let service: AlertRulesService;

  beforeEach(() => {
    (AlertRulesService as any).instance = undefined;
    service = AlertRulesService.getInstance();
  });

  it("testMode=true evaluates disabled rules", () => {
    const rule = makeRule({ status: "disabled" });
    // Without testMode, disabled rule never triggers
    expect(service.evaluateRule(rule, { health_score: 50 }, undefined, false).triggered).toBe(false);
    // With testMode, it evaluates conditions
    expect(service.evaluateRule(rule, { health_score: 50 }, undefined, true).testMode).toBe(true);
  });
});

describe("AlertRulesService — templates", () => {
  let service: AlertRulesService;

  beforeEach(() => {
    (AlertRulesService as any).instance = undefined;
    service = AlertRulesService.getInstance();
  });

  it("listTemplates returns built-in templates", () => {
    const templates = service.listTemplates();
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.id.startsWith("tpl:")).toBe(true);
      expect(t.conditions.length).toBeGreaterThan(0);
    }
  });

  it("getTemplate returns a specific template by id", () => {
    const tpl = service.getTemplate("tpl:price-deviation");
    expect(tpl).not.toBeNull();
    expect(tpl?.name).toBe("Price Deviation Alert");
  });

  it("getTemplate returns null for unknown id", () => {
    expect(service.getTemplate("tpl:nonexistent")).toBeNull();
  });
});

describe("AlertRulesService — validation", () => {
  let service: AlertRulesService;

  beforeEach(() => {
    (AlertRulesService as any).instance = undefined;
    service = AlertRulesService.getInstance();
  });

  it("throws when conditions array is empty", () => {
    expect(() => (service as any).validateConditions([])).toThrow("At least one condition is required");
  });

  it("throws when between operator missing thresholdHigh", () => {
    expect(() =>
      (service as any).validateConditions([{ metric: "x", operator: "between", threshold: 10 }])
    ).toThrow("thresholdHigh");
  });
});

describe("AlertRulesService — singleton", () => {
  it("getInstance returns the same instance", () => {
    (AlertRulesService as any).instance = undefined;
    expect(AlertRulesService.getInstance()).toBe(AlertRulesService.getInstance());
  });
});
