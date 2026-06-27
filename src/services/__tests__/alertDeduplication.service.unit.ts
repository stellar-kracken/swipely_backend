import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUpdateSeverity = vi.fn().mockResolvedValue(null);
const mockUpdateStatus = vi.fn().mockResolvedValue(null);
const mockCreate = vi.fn();
const mockFirst = vi.fn();
const mockMapRow = vi.fn((r: any) => r);

vi.mock("../incident.service.js", () => ({
  IncidentService: vi.fn().mockImplementation(() => ({
    updateIncidentSeverity: mockUpdateSeverity,
    updateIncidentStatus: mockUpdateStatus,
    createIncident: mockCreate,
    mapDatabaseRow: mockMapRow,
  })),
}));

vi.mock("../../database/connection.js", () => ({
  getDatabase: () => ({
    __esModule: true,
    // knex-style chainable query builder stub
    ...(() => {
      const q: any = {};
      ["where", "andWhere", "orderBy"].forEach((m) => {
        q[m] = () => q;
      });
      q.first = mockFirst;
      return (table: string) => q;
    })(),
  }),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AlertDeduplicationService } from "../alertDeduplication.service.js";
import type { AlertEvent } from "../alert.service.js";

function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    eventId: "evt-1",
    ruleId: "rule-1",
    assetCode: "USDC",
    alertType: "price_deviation",
    priority: "medium",
    triggeredValue: 0.97,
    threshold: 0.99,
    metric: "price",
    time: new Date(),
    webhookDelivered: false,
    onChainEventId: null,
    lifecycleState: "open",
    acknowledgedAt: null,
    acknowledgedBy: null,
    assignedAt: null,
    assignedTo: null,
    closedAt: null,
    closedBy: null,
    closureNote: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("AlertDeduplicationService", () => {
  let svc: AlertDeduplicationService;

  beforeEach(() => {
    vi.clearAllMocks();
    (AlertDeduplicationService as any).instance = undefined;
    svc = AlertDeduplicationService.getInstance();
  });

  describe("deduplicate — new incident creation", () => {
    it("creates an incident with derived bridgeId when no match exists", async () => {
      mockFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue({ id: "inc-1", bridgeId: "bridge-usdc", severity: "medium" });

      const event = makeEvent({ assetCode: "USDC", priority: "medium" });
      const incident = await svc.deduplicate(event);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ bridgeId: "bridge-usdc" })
      );
      expect(incident.bridgeId).toBe("bridge-usdc");
    });

    it("never passes 'unknown' as bridgeId", async () => {
      mockFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue({ id: "inc-2", bridgeId: "bridge-wbtc", severity: "low" });

      await svc.deduplicate(makeEvent({ assetCode: "WBTC" }));

      const call = mockCreate.mock.calls[0][0];
      expect(call.bridgeId).not.toBe("unknown");
    });
  });

  describe("deduplicate — existing incident merge", () => {
    it("escalates severity and sets status to investigating when incoming priority is higher", async () => {
      const existing = {
        id: "inc-existing",
        severity: "low",
        status: "open",
        assetCode: "USDC",
        bridgeId: "bridge-usdc",
      };
      mockFirst.mockResolvedValue(existing);
      mockMapRow.mockReturnValue(existing);

      await svc.deduplicate(makeEvent({ priority: "high" }));

      expect(mockUpdateSeverity).toHaveBeenCalledWith("inc-existing", "high");
      expect(mockUpdateStatus).toHaveBeenCalledWith("inc-existing", "investigating");
    });

    it("does not update severity when incoming priority is not higher", async () => {
      const existing = {
        id: "inc-existing",
        severity: "critical",
        status: "open",
        assetCode: "USDC",
        bridgeId: "bridge-usdc",
      };
      mockFirst.mockResolvedValue(existing);
      mockMapRow.mockReturnValue(existing);

      await svc.deduplicate(makeEvent({ priority: "low" }));

      expect(mockUpdateSeverity).not.toHaveBeenCalled();
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });
  });

  describe("escalateSeverity", () => {
    it("returns higher severity between current and incoming", () => {
      const escalate = (svc as any).escalateSeverity.bind(svc);
      expect(escalate("low", "high")).toBe("high");
      expect(escalate("critical", "medium")).toBe("critical");
      expect(escalate("medium", "medium")).toBe("medium");
    });
  });
});
