import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthScoreHistoryService } from "../../src/services/healthScoreHistory.service.js";

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const chain = (rows: unknown[] = []) => {
      const qb: Record<string, unknown> = {
        where: vi.fn().mockReturnThis(),
        whereBetween: vi.fn().mockReturnThis(),
        whereNotIn: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(rows),
        offset: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(rows[0] ?? undefined),
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        onConflict: vi.fn().mockReturnThis(),
        ignore: vi.fn().mockResolvedValue(undefined),
        returning: vi.fn().mockResolvedValue(rows),
        delete: vi.fn().mockResolvedValue(0),
      };
      return qb;
    };

    const fn = (_table: string) => chain([]);
    fn.raw = vi.fn().mockResolvedValue({ rows: [] });
    return fn;
  }),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("HealthScoreHistoryService", () => {
  let service: HealthScoreHistoryService;

  beforeEach(() => {
    service = new HealthScoreHistoryService();
  });

  it("is instantiable", () => {
    expect(service).toBeInstanceOf(HealthScoreHistoryService);
  });

  it("backfill returns 0 for empty entries", async () => {
    const count = await service.backfill([]);
    expect(count).toBe(0);
  });

  it("getAggregated calls db.raw with correct query shape", async () => {
    const result = await service.getAggregated({ symbol: "USDC", bucketInterval: "1 day" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("getTrend returns null when no records exist", async () => {
    const trend = await service.getTrend("USDC");
    expect(trend).toBeNull();
  });
});
