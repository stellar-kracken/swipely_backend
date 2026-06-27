import { describe, it, expect } from "vitest";
import { RiskScoringService } from "../../src/services/risk/risk-scoring.service.js";
import { RISK_WEIGHTS } from "../../src/services/risk/risk.constants.js";

describe("RiskScoringService", () => {
  const service = new RiskScoringService();

  describe("score composition", () => {
    it("returns 100 when all factors are 100", () => {
      const result = service.computeScore("bridge-1", {
        reserveBacking: 100,
        operatorReputation: 100,
        transactionHistory: 100,
        anomalyFrequency: 100,
        resolutionTime: 100,
      });
      expect(result.riskScore).toBe(100);
    });

    it("returns 0 when all factors are 0", () => {
      const result = service.computeScore("bridge-2", {
        reserveBacking: 0,
        operatorReputation: 0,
        transactionHistory: 0,
        anomalyFrequency: 0,
        resolutionTime: 0,
      });
      expect(result.riskScore).toBe(0);
    });

    it("defaults missing factors to 50 and returns 50", () => {
      const result = service.computeScore("bridge-3", {});
      expect(result.factors.reserveBacking).toBe(50);
      expect(result.factors.operatorReputation).toBe(50);
      expect(result.factors.transactionHistory).toBe(50);
      expect(result.factors.anomalyFrequency).toBe(50);
      expect(result.factors.resolutionTime).toBe(50);
      expect(result.riskScore).toBe(50);
    });

    it("preserves bridgeId in result", () => {
      const result = service.computeScore("stellar-bridge-001", {});
      expect(result.bridgeId).toBe("stellar-bridge-001");
    });

    it("includes the resolved factors in the result", () => {
      const factors = {
        reserveBacking: 80,
        operatorReputation: 60,
        transactionHistory: 40,
        anomalyFrequency: 20,
        resolutionTime: 10,
      };
      const result = service.computeScore("b", factors);
      expect(result.factors).toEqual(factors);
    });

    it("fills in only the missing factors with 50", () => {
      const result = service.computeScore("b", { reserveBacking: 100 });
      expect(result.factors.reserveBacking).toBe(100);
      expect(result.factors.operatorReputation).toBe(50);
      expect(result.factors.transactionHistory).toBe(50);
      expect(result.factors.anomalyFrequency).toBe(50);
      expect(result.factors.resolutionTime).toBe(50);
    });
  });

  describe("weighting", () => {
    it("applies reserveBacking weight of 35%", () => {
      const result = service.computeScore("b", {
        reserveBacking: 100,
        operatorReputation: 0,
        transactionHistory: 0,
        anomalyFrequency: 0,
        resolutionTime: 0,
      });
      expect(result.riskScore).toBe(Math.round(100 * RISK_WEIGHTS.reserveBacking));
    });

    it("applies operatorReputation weight of 20%", () => {
      const result = service.computeScore("b", {
        reserveBacking: 0,
        operatorReputation: 100,
        transactionHistory: 0,
        anomalyFrequency: 0,
        resolutionTime: 0,
      });
      expect(result.riskScore).toBe(Math.round(100 * RISK_WEIGHTS.operatorReputation));
    });

    it("applies transactionHistory weight of 15%", () => {
      const result = service.computeScore("b", {
        reserveBacking: 0,
        operatorReputation: 0,
        transactionHistory: 100,
        anomalyFrequency: 0,
        resolutionTime: 0,
      });
      expect(result.riskScore).toBe(Math.round(100 * RISK_WEIGHTS.transactionHistory));
    });

    it("applies anomalyFrequency weight of 20%", () => {
      const result = service.computeScore("b", {
        reserveBacking: 0,
        operatorReputation: 0,
        transactionHistory: 0,
        anomalyFrequency: 100,
        resolutionTime: 0,
      });
      expect(result.riskScore).toBe(Math.round(100 * RISK_WEIGHTS.anomalyFrequency));
    });

    it("applies resolutionTime weight of 10%", () => {
      const result = service.computeScore("b", {
        reserveBacking: 0,
        operatorReputation: 0,
        transactionHistory: 0,
        anomalyFrequency: 0,
        resolutionTime: 100,
      });
      expect(result.riskScore).toBe(Math.round(100 * RISK_WEIGHTS.resolutionTime));
    });

    it("computes correct weighted sum across all factors", () => {
      const result = service.computeScore("b", {
        reserveBacking: 100,
        operatorReputation: 0,
        transactionHistory: 0,
        anomalyFrequency: 0,
        resolutionTime: 0,
      });
      const expected = Math.round(
        100 * 0.35 + 50 * 0.20 + 50 * 0.15 + 50 * 0.20 + 50 * 0.10
      );
      // all missing factors default to 50
      const full = service.computeScore("b", { reserveBacking: 100 });
      expect(full.riskScore).toBe(expected);
    });
  });

  describe("thresholds and level classification", () => {
    it("classifies score 0 as LOW", () => {
      const result = service.computeScore("b", {
        reserveBacking: 0, operatorReputation: 0, transactionHistory: 0,
        anomalyFrequency: 0, resolutionTime: 0,
      });
      expect(result.level).toBe("LOW");
    });

    it("classifies score 25 as LOW (boundary)", () => {
      const result = service.computeScore("b", {
        reserveBacking: 25, operatorReputation: 25, transactionHistory: 25,
        anomalyFrequency: 25, resolutionTime: 25,
      });
      expect(result.riskScore).toBe(25);
      expect(result.level).toBe("LOW");
    });

    it("classifies score 26 as MODERATE", () => {
      const result = service.computeScore("b", {
        reserveBacking: 26, operatorReputation: 26, transactionHistory: 26,
        anomalyFrequency: 26, resolutionTime: 26,
      });
      expect(result.level).toBe("MODERATE");
    });

    it("classifies score 50 as MODERATE (boundary)", () => {
      const result = service.computeScore("b", {
        reserveBacking: 50, operatorReputation: 50, transactionHistory: 50,
        anomalyFrequency: 50, resolutionTime: 50,
      });
      expect(result.riskScore).toBe(50);
      expect(result.level).toBe("MODERATE");
    });

    it("classifies score 51 as HIGH", () => {
      const result = service.computeScore("b", {
        reserveBacking: 51, operatorReputation: 51, transactionHistory: 51,
        anomalyFrequency: 51, resolutionTime: 51,
      });
      expect(result.level).toBe("HIGH");
    });

    it("classifies score 75 as HIGH (boundary)", () => {
      const result = service.computeScore("b", {
        reserveBacking: 75, operatorReputation: 75, transactionHistory: 75,
        anomalyFrequency: 75, resolutionTime: 75,
      });
      expect(result.riskScore).toBe(75);
      expect(result.level).toBe("HIGH");
    });

    it("classifies score 76 as CRITICAL", () => {
      const result = service.computeScore("b", {
        reserveBacking: 76, operatorReputation: 76, transactionHistory: 76,
        anomalyFrequency: 76, resolutionTime: 76,
      });
      expect(result.level).toBe("CRITICAL");
    });

    it("classifies score 100 as CRITICAL", () => {
      const result = service.computeScore("b", {
        reserveBacking: 100, operatorReputation: 100, transactionHistory: 100,
        anomalyFrequency: 100, resolutionTime: 100,
      });
      expect(result.riskScore).toBe(100);
      expect(result.level).toBe("CRITICAL");
    });

    it("clamps negative scores to 0", () => {
      const result = service.computeScore("b", {
        reserveBacking: -50, operatorReputation: -50, transactionHistory: -50,
        anomalyFrequency: -50, resolutionTime: -50,
      });
      expect(result.riskScore).toBe(0);
    });

    it("clamps scores above 100 to 100", () => {
      const result = service.computeScore("b", {
        reserveBacking: 200, operatorReputation: 200, transactionHistory: 200,
        anomalyFrequency: 200, resolutionTime: 200,
      });
      expect(result.riskScore).toBe(100);
    });
  });
});
