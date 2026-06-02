import { describe, it, expect, beforeEach } from "vitest";
import { DuplicateAlertCheckService } from "../duplicateAlertCheck.service";
import type { AlertEvent } from "../alert.service";

function makeEvent(overrides: Partial<AlertEvent> = {}): Omit<AlertEvent, "eventId"> {
  return {
    ruleId: "rule-1",
    assetCode: "USDC",
    alertType: "price_deviation",
    priority: "medium",
    triggeredValue: 0.98,
    threshold: 0.99,
    metric: "price",
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
    time: new Date(),
    ...overrides,
  };
}

describe("DuplicateAlertCheckService", () => {
  let svc: DuplicateAlertCheckService;

  beforeEach(() => {
    // Reset singleton for test isolation
    (DuplicateAlertCheckService as any).instance = undefined;
    svc = DuplicateAlertCheckService.getInstance();
  });

  describe("check — no prior events", () => {
    it("allows a fresh alert with no recorded events", () => {
      const result = svc.check(makeEvent());
      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe("allow");
    });
  });

  describe("check — block behavior", () => {
    it("blocks an identical alert within the dedup window", () => {
      const event = makeEvent();
      svc.record({ ...event, eventId: "evt-001" });

      const result = svc.check(event);
      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe("block");
      expect(result.matchedEventId).toBe("evt-001");
    });

    it("allows an identical alert outside the dedup window", () => {
      // Record an event 15 minutes in the past (beyond default 10-min block window)
      const pastTime = new Date(Date.now() - 15 * 60 * 1000);
      svc.record({ ...makeEvent(), eventId: "evt-old", time: pastTime });

      const result = svc.check(makeEvent());
      expect(result.action).toBe("allow");
    });
  });

  describe("check — source matching", () => {
    it("treats different assetCodes as distinct alerts", () => {
      svc.record({ ...makeEvent({ assetCode: "USDC" }), eventId: "evt-usdc" });

      const result = svc.check(makeEvent({ assetCode: "USDT" }));
      expect(result.action).toBe("allow");
    });

    it("treats different alertTypes as distinct alerts (block rule)", () => {
      svc.record({ ...makeEvent({ alertType: "bridge_downtime" }), eventId: "evt-down" });

      const result = svc.check(makeEvent({ alertType: "price_deviation" }));
      // block rule matches on [assetCode, alertType, metric] — different alertType so no match
      expect(result.action).toBe("allow");
    });
  });

  describe("check — severity handling (escalate)", () => {
    it("escalates priority when the same asset+type re-fires within the escalation window", () => {
      // Remove non-escalate rules so only the escalate rule fires
      const rules = svc.getDedupRules();
      for (const r of rules) {
        if (r.id !== "default-critical-escalate") svc.deleteDedupRule(r.id);
      }

      svc.record({ ...makeEvent({ priority: "low" }), eventId: "evt-low" });

      const result = svc.check(makeEvent({ priority: "high" }));
      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe("escalate");
      expect(result.escalatedPriority).toBe("high");
    });

    it("keeps existing priority when incoming is lower", () => {
      const rules = svc.getDedupRules();
      for (const r of rules) {
        if (r.id !== "default-critical-escalate") svc.deleteDedupRule(r.id);
      }

      svc.record({ ...makeEvent({ priority: "critical" }), eventId: "evt-critical" });

      const result = svc.check(makeEvent({ priority: "low" }));
      expect(result.escalatedPriority).toBe("critical");
    });
  });

  describe("check — review queue", () => {
    it("enqueues a near-duplicate for review", () => {
      // Keep only the review rule
      const rules = svc.getDedupRules();
      for (const r of rules) {
        if (r.id !== "default-cross-source") svc.deleteDedupRule(r.id);
      }

      svc.record({ ...makeEvent(), eventId: "evt-original" });

      const result = svc.check(makeEvent({ alertType: "supply_mismatch" }));
      // cross-source rule matches on [assetCode, metric] only — same assetCode + metric
      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe("review");

      const queue = svc.getReviewQueue("pending");
      expect(queue.length).toBe(1);
      expect(queue[0].matchedEventId).toBe("evt-original");
    });
  });

  describe("dedup rule management", () => {
    it("adds and retrieves a custom rule", () => {
      const rule = svc.addDedupRule({
        name: "custom rule",
        alertType: "bridge_downtime",
        assetCode: "*",
        windowMs: 60_000,
        matchFields: ["assetCode", "alertType"],
        severityBehavior: "block",
        isActive: true,
      });
      expect(svc.getDedupRule(rule.id)).toMatchObject({ name: "custom rule" });
    });

    it("updates a rule", () => {
      const rule = svc.addDedupRule({
        name: "to-update",
        alertType: "*",
        assetCode: "*",
        windowMs: 1000,
        matchFields: ["assetCode"],
        severityBehavior: "block",
        isActive: true,
      });
      const updated = svc.updateDedupRule(rule.id, { isActive: false });
      expect(updated?.isActive).toBe(false);
    });

    it("deletes a rule", () => {
      const rule = svc.addDedupRule({
        name: "to-delete",
        alertType: "*",
        assetCode: "*",
        windowMs: 1000,
        matchFields: ["assetCode"],
        severityBehavior: "block",
        isActive: true,
      });
      expect(svc.deleteDedupRule(rule.id)).toBe(true);
      expect(svc.getDedupRule(rule.id)).toBeUndefined();
    });

    it("returns null when updating a non-existent rule", () => {
      expect(svc.updateDedupRule("non-existent", { isActive: false })).toBeNull();
    });

    it("returns false when deleting a non-existent rule", () => {
      expect(svc.deleteDedupRule("non-existent")).toBe(false);
    });
  });

  describe("review queue management", () => {
    it("resolves a pending entry as approved", () => {
      const rules = svc.getDedupRules();
      for (const r of rules) {
        if (r.id !== "default-cross-source") svc.deleteDedupRule(r.id);
      }

      svc.record({ ...makeEvent(), eventId: "evt-base" });
      svc.check(makeEvent({ alertType: "supply_mismatch" }));

      const queue = svc.getReviewQueue("pending");
      const entry = svc.reviewEntry(queue[0].id, "approved", "admin@example.com");

      expect(entry?.status).toBe("approved");
      expect(entry?.reviewedBy).toBe("admin@example.com");
      expect(svc.getReviewQueue("pending").length).toBe(0);
    });

    it("returns null when resolving a non-existent entry", () => {
      expect(svc.reviewEntry("no-such-id", "approved", "admin")).toBeNull();
    });
  });
});
