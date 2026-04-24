import { describe, expect, it } from "vitest";
import {
  AlertRoutingService,
  type AlertRoutingRule,
  type RouteableAlert,
} from "../../src/services/alertRouting.service.js";

function makeRule(overrides: Partial<AlertRoutingRule> = {}): AlertRoutingRule {
  return {
    id: "route-1",
    name: "Default",
    ownerAddress: null,
    severityLevels: ["critical", "high", "medium", "low"],
    assetCodes: [],
    sourceTypes: [],
    channels: ["in_app"],
    fallbackChannels: ["in_app"],
    suppressionWindowSeconds: 0,
    priorityOrder: 100,
    isActive: true,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeAlert(overrides: Partial<RouteableAlert> = {}): RouteableAlert {
  return {
    eventTime: new Date(),
    alertRuleId: "rule-1",
    ownerAddress: "GABC123",
    ruleName: "USDC deviation",
    assetCode: "USDC",
    sourceType: "price_deviation",
    severity: "high",
    triggeredValue: 12,
    threshold: 10,
    metric: "price_deviation_bps",
    ...overrides,
  };
}

describe("AlertRoutingService decision logic", () => {
  const service = new AlertRoutingService() as unknown as {
    matchesRule: (rule: AlertRoutingRule, alert: RouteableAlert) => boolean;
    resolvePrimaryChannels: (
      rule: AlertRoutingRule | null,
      ownerPreferences: {
        minSeverity: "critical" | "high" | "medium" | "low";
        channels: Array<"in_app" | "webhook" | "email">;
        mutedAssets: string[];
      }
    ) => Array<"in_app" | "webhook" | "email">;
    meetsSeverityThreshold: (
      actual: "critical" | "high" | "medium" | "low",
      minimum: "critical" | "high" | "medium" | "low"
    ) => boolean;
  };

  it("matches rule by severity, asset, and source", () => {
    const rule = makeRule({
      severityLevels: ["critical", "high"],
      assetCodes: ["USDC"],
      sourceTypes: ["price_deviation"],
    });

    expect(service.matchesRule(rule, makeAlert())).toBe(true);
    expect(service.matchesRule(rule, makeAlert({ severity: "low" }))).toBe(false);
    expect(service.matchesRule(rule, makeAlert({ assetCode: "EURC" }))).toBe(false);
    expect(service.matchesRule(rule, makeAlert({ sourceType: "bridge_downtime" }))).toBe(false);
  });

  it("prefers intersection of rule channels and owner preferences", () => {
    const channels = service.resolvePrimaryChannels(makeRule({ channels: ["in_app", "webhook"] }), {
      minSeverity: "medium",
      channels: ["webhook"],
      mutedAssets: [],
    });

    expect(channels).toEqual(["webhook"]);
  });

  it("falls back to in_app when preferences and rule channels are empty", () => {
    const channels = service.resolvePrimaryChannels(makeRule({ channels: [] }), {
      minSeverity: "medium",
      channels: [],
      mutedAssets: [],
    });

    expect(channels).toEqual(["in_app"]);
  });

  it("applies severity threshold ordering correctly", () => {
    expect(service.meetsSeverityThreshold("critical", "high")).toBe(true);
    expect(service.meetsSeverityThreshold("high", "high")).toBe(true);
    expect(service.meetsSeverityThreshold("medium", "high")).toBe(false);
  });
});
