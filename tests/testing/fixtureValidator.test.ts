import { describe, it, expect } from "vitest";
import {
  AssetHealthFixtureSchema,
  BridgeSchema,
  HealthScoreSchema,
  summarise,
  validateAllFixtures,
  validateData,
} from "../../src/testing/fixtureValidator/index.js";

describe("fixture validator", () => {
  describe("registered fixtures", () => {
    it("validates every registered fixture against the current API shapes", () => {
      const results = validateAllFixtures();

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.loaded).toBe(true);
        const errors = result.findings.filter((f) => f.severity === "error");
        expect(
          errors,
          `${result.file} drifted from the API shape: ${JSON.stringify(errors, null, 2)}`,
        ).toEqual([]);
        expect(result.ok).toBe(true);
      }
    });

    it("produces no findings of any severity for the committed fixtures", () => {
      const summary = summarise(validateAllFixtures(), { strict: true });
      expect(summary.errorCount).toBe(0);
      expect(summary.warningCount).toBe(0);
      expect(summary.failed).toBe(false);
    });
  });

  describe("drift detection", () => {
    const validBridge = {
      name: "Allbridge",
      status: "healthy",
      totalValueLocked: 1525000,
      supplyOnStellar: 1200000,
      supplyOnSource: 1201500,
      mismatchPercentage: 0.124,
    };

    it("accepts a payload matching the schema", () => {
      expect(validateData(validBridge, BridgeSchema)).toEqual([]);
    });

    it("flags a missing required field as an error", () => {
      const { mismatchPercentage, ...withoutMismatch } = validBridge;
      void mismatchPercentage;
      const findings = validateData(withoutMismatch, BridgeSchema);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe("error");
      expect(findings[0].path).toBe("mismatchPercentage");
    });

    it("flags a wrong type as an error", () => {
      const findings = validateData(
        { ...validBridge, totalValueLocked: "lots" },
        BridgeSchema,
      );

      expect(findings.some((f) => f.severity === "error")).toBe(true);
      expect(findings.some((f) => f.path === "totalValueLocked")).toBe(true);
    });

    it("flags an invalid enum value as an error", () => {
      const findings = validateData(
        { ...validBridge, status: "on-fire" },
        BridgeSchema,
      );

      expect(findings.some((f) => f.path === "status" && f.severity === "error")).toBe(
        true,
      );
    });

    it("reports an unexpected property as a warning, not an error", () => {
      const findings = validateData(
        { ...validBridge, legacyField: true },
        BridgeSchema,
      );

      const warning = findings.find((f) => f.path === "legacyField");
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe("warning");
      expect(findings.some((f) => f.severity === "error")).toBe(false);
    });

    it("points at the correct nested path for record fixtures", () => {
      const findings = validateData(
        {
          USDC: {
            symbol: "USDC",
            overallScore: 92,
            factors: {
              liquidityDepth: "high",
              priceStability: 89,
              bridgeUptime: 96,
              reserveBacking: 93,
              volumeTrend: 90,
            },
            trend: "improving",
            lastUpdated: "2026-01-01T00:00:00.000Z",
          },
        },
        AssetHealthFixtureSchema,
      );

      expect(findings.some((f) => f.path === "USDC.factors.liquidityDepth")).toBe(true);
    });
  });

  describe("summarise", () => {
    const validHealth = {
      symbol: "USDC",
      overallScore: 92,
      factors: {
        liquidityDepth: 94,
        priceStability: 89,
        bridgeUptime: 96,
        reserveBacking: 93,
        volumeTrend: 90,
      },
      trend: "improving",
      lastUpdated: "2026-01-01T00:00:00.000Z",
    };

    it("does not fail on warnings unless strict mode is enabled", () => {
      const findings = validateData(
        { ...validHealth, deprecated: 1 },
        HealthScoreSchema,
      );
      const result = {
        name: "synthetic",
        file: "synthetic.json",
        description: "synthetic",
        loaded: true,
        ok: true,
        findings,
      };

      expect(summarise([result]).failed).toBe(false);
      expect(summarise([result], { strict: true }).failed).toBe(true);
    });
  });
});
