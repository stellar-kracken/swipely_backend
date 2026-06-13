import { describe, it, expect, beforeEach } from "vitest";
import { CorrelationService } from "../correlation.service";

describe("CorrelationService scoring", () => {
  let svc: CorrelationService;
  beforeEach(() => {
    svc = new CorrelationService();
  });

  it("gives high score for identical normalized_fingerprint", () => {
    const a = { normalized_fingerprint: "abc", bridge_id: "b1", title: "error on host X", description: "panic" , occurred_at: new Date().toISOString(), asset_code: null, severity: "high" };
    const b = { normalized_fingerprint: "abc", bridge_id: "b2", title: "panic at host X", description: "stack trace" , occurred_at: new Date().toISOString(), asset_code: null, severity: "high" };
    const { score } = svc.scoreSimilarity(a as any, b as any);
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it("considers text similarity and time window", () => {
    const now = new Date();
    const a = { normalized_fingerprint: null, bridge_id: "b1", title: "timeout connecting to node", description: "failed to connect", occurred_at: now.toISOString(), asset_code: "USDC", severity: "high" };
    const b = { normalized_fingerprint: null, bridge_id: "b1", title: "node connection timeout", description: "connection refused", occurred_at: new Date(now.getTime() + 1000 * 30).toISOString(), asset_code: "USDC", severity: "high" };
    const { score, reasons } = svc.scoreSimilarity(a as any, b as any);
    expect(score).toBeGreaterThan(0.3);
    expect(reasons).toContain("bridge_id");
    expect(reasons).toContain("time_window_1h");
  });
});
