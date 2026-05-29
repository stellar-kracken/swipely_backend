import { describe, it, expect } from "vitest";
import {
  normalizeAlertHistoryQuery,
  alertEventsToCsv,
  MAX_PAGE_SIZE,
} from "../../src/services/alertHistorySearch.service.js";

describe("normalizeAlertHistoryQuery", () => {
  it("applies defaults for an empty query", () => {
    const q = normalizeAlertHistoryQuery({});
    expect(q).toMatchObject({ severities: [], sources: [], alertTypes: [], page: 1, pageSize: 50 });
    expect(q.from).toBeUndefined();
    expect(q.text).toBeUndefined();
  });

  it("parses comma lists and arrays for filters", () => {
    const q = normalizeAlertHistoryQuery({ severity: "high,critical", source: ["USDC", "EURC"] });
    expect(q.severities).toEqual(["high", "critical"]);
    expect(q.sources).toEqual(["USDC", "EURC"]);
  });

  it("parses dates and trims the full-text term", () => {
    const q = normalizeAlertHistoryQuery({ from: "2026-01-01", to: "2026-02-01", q: "  depeg  " });
    expect(q.from?.toISOString()).toContain("2026-01-01");
    expect(q.text).toBe("depeg");
  });

  it("clamps pageSize to the maximum", () => {
    expect(normalizeAlertHistoryQuery({ pageSize: 10_000 }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("rejects invalid dates, ranges and pagination", () => {
    expect(() => normalizeAlertHistoryQuery({ from: "not-a-date" })).toThrow(/from/);
    expect(() => normalizeAlertHistoryQuery({ from: "2026-02-01", to: "2026-01-01" })).toThrow(/before/);
    expect(() => normalizeAlertHistoryQuery({ page: 0 })).toThrow(/page/);
  });
});

describe("alertEventsToCsv", () => {
  it("emits a header and a row per event", () => {
    const csv = alertEventsToCsv([
      {
        time: "2026-01-01T00:00:00Z",
        rule_id: "r1",
        asset_code: "USDC",
        alert_type: "depeg",
        priority: "high",
        metric: "price",
        triggered_value: "0.95",
        threshold: "0.98",
      },
    ]);
    const [header, row] = csv.split("\n");
    expect(header).toBe("time,rule_id,asset_code,alert_type,priority,metric,triggered_value,threshold");
    expect(row).toContain("USDC");
    expect(row).toContain("depeg");
  });

  it("escapes values containing commas or quotes", () => {
    const csv = alertEventsToCsv([{ asset_code: "A,B", metric: 'say "hi"' }]);
    const row = csv.split("\n")[1];
    expect(row).toContain('"A,B"');
    expect(row).toContain('"say ""hi"""');
  });
});
