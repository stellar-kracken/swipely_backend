import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { tableData, mockKnex } = vi.hoisted(() => {
  const tableData = new Map<string, Array<Record<string, unknown>>>();
  const createBuilder = (rows: Array<Record<string, unknown>>) => ({
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation((limit: number) => rows.slice(0, limit)),
  });
  const mockKnex = (table: string) => createBuilder(tableData.get(table) ?? []);
  return { tableData, mockKnex };
});

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockKnex,
}));

import { StalenessDetectionService } from "../../src/services/stalenessDetection.service.js";


vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/config/stalenessRules.js", () => ({
  STALENESS_RULES: [
    {
      key: "prices",
      label: "Prices",
      description: "Price data",
      table: "prices",
      timeColumn: "time",
      sourceType: "source",
      expectedIntervalMs: 30_000,
      warnAfterMs: 120_000,
      criticalAfterMs: 300_000,
    },
  ],
}));

const NOW = new Date("2026-06-01T00:00:00Z");

describe("StalenessDetectionService", () => {
  let service: StalenessDetectionService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    tableData.set("prices", []);
    service = new StalenessDetectionService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("marks data as stale when beyond the critical threshold", async () => {
    tableData.set("prices", [{ time: new Date(NOW.getTime() - 600_000) }]);

    const detail = await service.getSourceDetail("prices", { includeHistory: true });

    expect(detail?.status).toBe("stale");
    expect(detail?.ageMs).toBe(600_000);
  });

  it("returns a critical alert when data is missing", async () => {
    const alerts = await service.getAlerts();

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].key).toBe("prices");
  });

  it("reports stable trend when update intervals are consistent", async () => {
    tableData.set("prices", [
      { time: new Date(NOW.getTime()) },
      { time: new Date(NOW.getTime() - 30_000) },
      { time: new Date(NOW.getTime() - 60_000) },
    ]);

    const detail = await service.getSourceDetail("prices", { includeHistory: true });

    expect(detail?.trend).toBe("stable");
  });
});
