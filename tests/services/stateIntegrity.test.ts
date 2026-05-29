import { describe, it, expect, vi } from "vitest";
import {
  checkReserveIntegrity,
  type ReserveStateSnapshot,
} from "../../src/services/stateIntegrity.js";

const consistent: ReserveStateSnapshot = {
  assetCode: "USDC",
  totalSupply: 1000n,
  lockedReserve: 400n,
  reportedCirculating: 600n,
  holderBalances: [
    { address: "GA...1", balance: 250n },
    { address: "GA...2", balance: 350n },
  ],
};

describe("checkReserveIntegrity", () => {
  it("reports ok for an internally consistent snapshot", () => {
    const report = checkReserveIntegrity(consistent);
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("detects a circulating-vs-(supply-reserve) mismatch", () => {
    const report = checkReserveIntegrity({ ...consistent, reportedCirculating: 590n, holderBalances: undefined });
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.code)).toContain("CIRCULATING_MISMATCH");
  });

  it("flags reserve exceeding supply and negative amounts", () => {
    const report = checkReserveIntegrity({
      assetCode: "EURC",
      totalSupply: 100n,
      lockedReserve: 150n,
      reportedCirculating: -50n,
    });
    const codes = report.violations.map((v) => v.code);
    expect(codes).toContain("RESERVE_EXCEEDS_SUPPLY");
    expect(codes).toContain("NEGATIVE_CIRCULATING");
  });

  it("reconciles holder balances and detects duplicates", () => {
    const report = checkReserveIntegrity({
      ...consistent,
      holderBalances: [
        { address: "GA...1", balance: 250n },
        { address: "GA...1", balance: 300n }, // duplicate address AND sums to 550 != 600
      ],
    });
    const codes = report.violations.map((v) => v.code);
    expect(codes).toContain("DUPLICATE_HOLDER");
    expect(codes).toContain("HOLDER_SUM_MISMATCH");
  });

  it("invokes the onViolation event hook for each violation", () => {
    const onViolation = vi.fn();
    checkReserveIntegrity(
      { assetCode: "X", totalSupply: -1n, lockedReserve: 0n, reportedCirculating: 0n },
      { onViolation },
    );
    expect(onViolation).toHaveBeenCalled();
    expect(onViolation.mock.calls[0][0]).toHaveProperty("code", "NEGATIVE_SUPPLY");
  });
});
