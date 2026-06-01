import { describe, it, expect } from "vitest";
import { EventSubscriptionFilterService } from "../../src/services/eventSubscriptionFilter.service.js";

describe("EventSubscriptionFilterService", () => {
  const service = new EventSubscriptionFilterService();

  describe("matchesFilter", () => {
    it("matches when no filter constraints", () => {
      expect(
        service.matchesFilter({}, { eventType: "bridge.status_changed", asset: "USDC" }),
      ).toBe(true);
    });

    it("filters by asset", () => {
      expect(
        service.matchesFilter(
          { assets: ["USDC"] },
          { eventType: "alert.triggered", asset: "USDC" },
        ),
      ).toBe(true);
      expect(
        service.matchesFilter(
          { assets: ["USDC"] },
          { eventType: "alert.triggered", asset: "EURC" },
        ),
      ).toBe(false);
    });

    it("filters by severity and event type", () => {
      expect(
        service.matchesFilter(
          { severities: ["critical"], eventTypes: ["alert.triggered"] },
          { eventType: "alert.triggered", severity: "critical" },
        ),
      ).toBe(true);
      expect(
        service.matchesFilter(
          { severities: ["critical"] },
          { eventType: "alert.triggered", severity: "info" },
        ),
      ).toBe(false);
    });
  });

  describe("validateFilter", () => {
    it("rejects invalid severity", () => {
      expect(() =>
        service.validateFilter({ severities: ["invalid" as "info"] }),
      ).toThrow();
    });

    it("accepts valid filter", () => {
      const filter = service.validateFilter({
        assets: ["USDC"],
        sources: ["circle"],
      });
      expect(filter.assets).toEqual(["USDC"]);
    });
  });
});
