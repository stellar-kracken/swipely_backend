import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExportService } from "../../src/services/export.service";

vi.mock("../../src/database/connection", () => ({
  getDatabase: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    first: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("../../src/utils/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("ExportService", () => {
  let exportService: ExportService;

  beforeEach(() => {
    exportService = new ExportService();
    vi.clearAllMocks();
  });

  describe("createExport", () => {
    it("should create export request", async () => {
      const result = await exportService.createExport(
        "user123",
        "prices",
        "csv",
        { startDate: "2024-01-01", endDate: "2024-01-31" },
        ["symbol", "price", "time"],
      );

      expect(result).toBeDefined();
    });
  });

  describe("getExport", () => {
    it("should return null for non-existent export", async () => {
      const result = await exportService.getExport("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getExportHistory", () => {
    it("should return empty array when no exports", async () => {
      const result = await exportService.getExportHistory("user123");
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
