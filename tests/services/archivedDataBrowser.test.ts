import { describe, it, expect } from "vitest";
import {
  normalizeArchiveBrowserQuery,
  ARCHIVE_ENTITIES,
  MAX_PAGE_SIZE,
} from "../../src/services/archivedDataBrowser.service.js";

describe("normalizeArchiveBrowserQuery", () => {
  it("requires entityType", () => {
    expect(() => normalizeArchiveBrowserQuery({})).toThrow(/entityType/);
  });

  it("rejects unsupported entity types", () => {
    expect(() => normalizeArchiveBrowserQuery({ entityType: "unknown" })).toThrow(
      /unsupported entityType/,
    );
  });

  it("applies defaults for a valid entity", () => {
    const q = normalizeArchiveBrowserQuery({ entityType: "prices" });
    expect(q).toMatchObject({ entityType: "prices", page: 1, pageSize: 50 });
    expect(q.from).toBeUndefined();
  });

  it("parses date range and asset filter", () => {
    const q = normalizeArchiveBrowserQuery({
      entityType: "health_scores",
      asset: "USDC",
      from: "2026-01-01",
      to: "2026-02-01",
      q: "  snapshot  ",
    });
    expect(q.asset).toBe("USDC");
    expect(q.text).toBe("snapshot");
    expect(q.from?.toISOString()).toContain("2026-01-01");
  });

  it("clamps pageSize to the maximum", () => {
    expect(
      normalizeArchiveBrowserQuery({ entityType: "prices", pageSize: 10_000 }).pageSize,
    ).toBe(MAX_PAGE_SIZE);
  });

  it("rejects invalid date ranges", () => {
    expect(() =>
      normalizeArchiveBrowserQuery({
        entityType: "prices",
        from: "2026-02-01",
        to: "2026-01-01",
      }),
    ).toThrow(/before/);
  });
});

describe("ARCHIVE_ENTITIES", () => {
  it("maps archive tables for supported entity types", () => {
    expect(ARCHIVE_ENTITIES.prices.archiveTableName).toBe("prices_archive");
    expect(ARCHIVE_ENTITIES.pool_events.assetColumn).toBe("pool_id");
  });
});
