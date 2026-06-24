import { describe, it, expect } from "vitest";
import { SavedMetricService } from "../../src/services/savedMetric.service.js";

describe("SavedMetricService", () => {
  const service = new SavedMetricService();

  it("rejects non-SELECT formulas", () => {
    const result = service.validateFormula("DELETE FROM bridges");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("accepts read-only SELECT formulas", () => {
    const result = service.validateFormula(
      "SELECT bridge_id, COUNT(*) AS total FROM bridge_operators GROUP BY bridge_id",
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects multi-statement formulas", () => {
    const result = service.validateFormula("SELECT 1; DROP TABLE bridges");
    expect(result.valid).toBe(false);
  });
});
