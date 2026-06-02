import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuleEvaluatorService } from "../../src/services/ruleEvaluator.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const b: Record<string, unknown> = {};
    b.where = vi.fn().mockReturnValue(b);
    b.orderBy = vi.fn().mockReturnValue(b);
    b.insert = vi.fn().mockReturnValue(b);
    b.returning = vi.fn().mockResolvedValue([]);
    b.first = vi.fn().mockResolvedValue(null);
    b.limit = vi.fn().mockReturnValue(b);
    b.offset = vi.fn().mockResolvedValue([]);
    const fn = (_t: string) => b;
    return fn;
  }),
}));

describe("RuleEvaluatorService", () => {
  let service: RuleEvaluatorService;

  beforeEach(() => {
    (RuleEvaluatorService as any).instance = undefined;
    service = RuleEvaluatorService.getInstance();
  });

  describe("evaluate", () => {
    it("evaluates AND conditions - all pass", () => {
      const result = service.evaluate(
        {
          ruleName: "test-rule",
          assetCode: "USDC",
          conditions: [
            { field: "price", operator: "gt", value: 100 },
            { field: "volume", operator: "gt", value: 1000 },
          ],
          logicOperator: "AND",
        },
        { price: 150, volume: 5000 }
      );

      expect(result.triggered).toBe(true);
      expect(result.conditionResults).toHaveLength(2);
      expect(result.conditionResults[0].passed).toBe(true);
      expect(result.conditionResults[1].passed).toBe(true);
    });

    it("evaluates AND conditions - one fails", () => {
      const result = service.evaluate(
        {
          ruleName: "test-rule",
          assetCode: "USDC",
          conditions: [
            { field: "price", operator: "gt", value: 100 },
            { field: "volume", operator: "lt", value: 1000 },
          ],
          logicOperator: "AND",
        },
        { price: 150, volume: 5000 }
      );

      expect(result.triggered).toBe(false);
      expect(result.conditionResults[1].passed).toBe(false);
    });

    it("evaluates OR conditions - one passes", () => {
      const result = service.evaluate(
        {
          ruleName: "test-rule",
          assetCode: "USDC",
          conditions: [
            { field: "price", operator: "gt", value: 1000 },
            { field: "volume", operator: "gt", value: 100 },
          ],
          logicOperator: "OR",
        },
        { price: 50, volume: 500 }
      );

      expect(result.triggered).toBe(true);
    });

    it("validates conditions on evaluation", () => {
      expect(() =>
        service.evaluate(
          { ruleName: "empty", assetCode: "USDC", conditions: [], logicOperator: "AND" },
          {}
        )
      ).toThrow("At least one condition is required");
    });

    it("handles between operator", () => {
      const result = service.evaluate(
        {
          ruleName: "range-check",
          assetCode: "USDC",
          conditions: [{ field: "price", operator: "between", value: 100, valueHigh: 200 }],
          logicOperator: "AND",
        },
        { price: 150 }
      );
      expect(result.triggered).toBe(true);
    });

    it("handles changes_by_pct operator", () => {
      const result = service.evaluate(
        {
          ruleName: "change-check",
          assetCode: "USDC",
          conditions: [{ field: "price", operator: "changes_by_pct", value: 10 }],
          logicOperator: "AND",
        },
        { price: 120 },
        { price: 100 }
      );
      expect(result.triggered).toBe(true);
    });

    it("returns preview mode in result", () => {
      const result = service.evaluate(
        {
          ruleName: "preview",
          assetCode: "USDC",
          conditions: [{ field: "price", operator: "gt", value: 100 }],
          logicOperator: "AND",
        },
        { price: 150 },
        undefined,
        true
      );
      expect(result.previewMode).toBe(true);
    });

    it("returns condition details for each condition", () => {
      const result = service.evaluate(
        {
          ruleName: "detail-check",
          assetCode: "USDC",
          conditions: [{ field: "price", operator: "gt", value: 100, label: "Price check" }],
          logicOperator: "AND",
        },
        { price: 150 }
      );
      expect(result.conditionResults[0].field).toBe("price");
      expect(result.conditionResults[0].operator).toBe("gt");
      expect(result.conditionResults[0].expectedValue).toBe(100);
      expect(result.conditionResults[0].actualValue).toBe(150);
      expect(result.conditionResults[0].label).toBe("Price check");
    });
  });

  describe("evaluateBatch", () => {
    it("evaluates multiple rules against same metrics", () => {
      const results = service.evaluateBatch(
        [
          { ruleName: "rule-1", assetCode: "USDC", conditions: [{ field: "price", operator: "gt", value: 100 }], logicOperator: "AND" },
          { ruleName: "rule-2", assetCode: "USDC", conditions: [{ field: "price", operator: "lt", value: 50 }], logicOperator: "AND" },
        ],
        { price: 150 }
      );
      expect(results).toHaveLength(2);
      expect(results[0].triggered).toBe(true);
      expect(results[1].triggered).toBe(false);
    });
  });

  describe("getEvaluationHistory", () => {
    it("returns empty array when no history exists", async () => {
      const history = await service.getEvaluationHistory();
      expect(history).toEqual([]);
    });
  });
});
