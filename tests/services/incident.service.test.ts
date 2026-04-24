import { describe, it, expect, vi, beforeEach } from "vitest";
import { IncidentService } from "../../src/services/incident.service.js";

const mockDb: Record<string, unknown> = {};

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const chain = (rows: unknown[] = []) => ({
      where: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(rows[0] ?? undefined),
      select: vi.fn().mockResolvedValue(rows),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue(rows),
      onConflict: vi.fn().mockReturnThis(),
      ignore: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue([{ count: "0" }]),
      clone: vi.fn().mockReturnThis(),
    });

    const fn = (_table: string) => chain([]);
    fn.raw = vi.fn();
    return fn;
  }),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("IncidentService", () => {
  let service: IncidentService;

  beforeEach(() => {
    service = new IncidentService();
  });

  it("is instantiable", () => {
    expect(service).toBeInstanceOf(IncidentService);
  });

  it("mapRow converts snake_case DB row to camelCase interface", () => {
    const row = {
      id: "abc-123",
      bridge_id: "allbridge",
      asset_code: "USDC",
      severity: "high",
      status: "open",
      title: "Stuck transactions",
      description: "Multiple transactions pending",
      source_url: "https://example.com",
      follow_up_actions: JSON.stringify(["Check pool", "Contact support"]),
      occurred_at: new Date("2025-01-01T00:00:00Z"),
      resolved_at: null,
      created_at: new Date("2025-01-01T00:00:00Z"),
      updated_at: new Date("2025-01-01T00:00:00Z"),
    };

    // Access private method through cast
    const mapped = (service as unknown as { mapRow: (r: unknown) => unknown }).mapRow(row);
    expect(mapped).toMatchObject({
      id: "abc-123",
      bridgeId: "allbridge",
      assetCode: "USDC",
      severity: "high",
      status: "open",
      title: "Stuck transactions",
      followUpActions: ["Check pool", "Contact support"],
      resolvedAt: null,
    });
  });
});
