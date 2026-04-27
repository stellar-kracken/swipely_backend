import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlertSuppressionService, type SuppressionRule } from "../../src/services/alertSuppression.service.js";

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.insert = vi.fn().mockReturnValue(chain);
    chain.returning = vi.fn().mockResolvedValue([]);
    chain.delete = vi.fn().mockResolvedValue(0);
    chain.update = vi.fn().mockReturnValue(chain);
    const fn = (_table: string) => chain;
    return fn;
  }),
}));

function makeRule(overrides: Partial<SuppressionRule> = {}): SuppressionRule {
  return {
    id: "sup-1",
    name: "Night mute",
    description: null,
    isActive: true,
    assetCodes: ["USDC"],
    alertTypes: ["price_deviation"],
    priorities: ["high"],
    sources: ["price_deviation_bps"],
    daysOfWeek: [],
    windowStart: null,
    windowEnd: null,
    maintenanceMode: false,
    expiresAt: null,
    createdBy: "ops",
    updatedBy: "ops",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("AlertSuppressionService", () => {
  let service: AlertSuppressionService;

  beforeEach(() => {
    (AlertSuppressionService as any).instance = undefined;
    service = AlertSuppressionService.getInstance();
  });

  it("suppresses alerts when a matching rule exists", async () => {
    vi.spyOn(service, "listRules").mockResolvedValue([makeRule()]);
    vi.spyOn(service as any, "writeAudit").mockResolvedValue(undefined);

    const decision = await service.shouldSuppress({
      assetCode: "USDC",
      alertType: "price_deviation",
      priority: "high",
      source: "price_deviation_bps",
      at: new Date(),
    });

    expect(decision.suppressed).toBe(true);
    expect(decision.matchedRule?.id).toBe("sup-1");
  });

  it("does not suppress alerts when rule filters do not match", async () => {
    vi.spyOn(service, "listRules").mockResolvedValue([makeRule({ assetCodes: ["EURC"] })]);
    vi.spyOn(service as any, "writeAudit").mockResolvedValue(undefined);

    const decision = await service.shouldSuppress({
      assetCode: "USDC",
      alertType: "price_deviation",
      priority: "high",
      source: "price_deviation_bps",
    });

    expect(decision.suppressed).toBe(false);
    expect(decision.matchedRule).toBeNull();
  });

  it("ignores expired rules", async () => {
    vi.spyOn(service, "listRules").mockResolvedValue([
      makeRule({ expiresAt: new Date(Date.now() - 60_000) }),
    ]);
    vi.spyOn(service as any, "writeAudit").mockResolvedValue(undefined);

    const decision = await service.shouldSuppress({
      assetCode: "USDC",
      alertType: "price_deviation",
      priority: "high",
      source: "price_deviation_bps",
      at: new Date(),
    });

    expect(decision.suppressed).toBe(false);
  });

  it("returns maintenance reason for maintenance rules", async () => {
    vi.spyOn(service, "listRules").mockResolvedValue([
      makeRule({ maintenanceMode: true, assetCodes: [], alertTypes: [], priorities: [], sources: [] }),
    ]);
    vi.spyOn(service as any, "writeAudit").mockResolvedValue(undefined);

    const decision = await service.shouldSuppress({
      assetCode: "USDC",
      alertType: "price_deviation",
      priority: "high",
      source: "price_deviation_bps",
      at: new Date(),
    });

    expect(decision.suppressed).toBe(true);
    expect(decision.reason).toContain("Maintenance");
  });
});
