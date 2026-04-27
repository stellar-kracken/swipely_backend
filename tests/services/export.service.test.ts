import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportService } from "../../src/services/export.service";

const { getDatabaseMock, exportQueueAddMock } = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  exportQueueAddMock: vi.fn(),
}));

function createQueryBuilder() {
  const builder: any = {
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    offset: vi.fn(async () => []),
    update: vi.fn(async () => undefined),
    first: vi.fn(async () => undefined),
    count: vi.fn(() => ({
      first: vi.fn(async () => ({ count: 0 })),
    })),
    insert: vi.fn(() => ({
      returning: vi.fn(async () => []),
    })),
  };

  return builder;
}

vi.mock("../../src/database/connection", () => ({
  getDatabase: getDatabaseMock,
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

vi.mock("../../src/jobs/export.job.js", () => ({
  exportQueue: {
    add: exportQueueAddMock,
  },
}));

describe("ExportService", () => {
  let exportService: ExportService;
  let exportHistoryQuery: ReturnType<typeof createQueryBuilder>;

  beforeEach(() => {
    exportService = new ExportService();
    exportHistoryQuery = createQueryBuilder();
    getDatabaseMock.mockImplementation(() => {
      const db: any = vi.fn((table: string) => {
        if (table === "export_history") {
          return exportHistoryQuery;
        }

        return createQueryBuilder();
      });

      return db;
    });
    exportQueueAddMock.mockResolvedValue({ id: "job-1" });
    vi.clearAllMocks();
  });

  describe("requestExport", () => {
    it("should create export request", async () => {
      const createdRecord = {
        id: "export-1",
        requested_by: "user123",
        format: "csv",
        data_type: "analytics",
        filters: JSON.stringify({ startDate: "2024-01-01", endDate: "2024-01-31" }),
        status: "pending",
        file_path: null,
        download_url: null,
        download_url_expires_at: null,
        file_size_bytes: null,
        is_compressed: false,
        error_message: null,
        email_delivery: false,
        email_address: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      exportHistoryQuery.insert.mockReturnValue({
        returning: vi.fn(async () => [createdRecord]),
      });

      const result = await exportService.requestExport("user123", {
        format: "csv",
        dataType: "analytics",
        filters: { startDate: "2024-01-01", endDate: "2024-01-31" },
      });

      expect(result).toBeDefined();
      expect(result.id).toBe("export-1");
      expect(exportQueueAddMock).toHaveBeenCalled();
    });
  });

  describe("getExportStatus", () => {
    it("should return null for non-existent export", async () => {
      exportHistoryQuery.first.mockResolvedValue(null);

      const result = await exportService.getExportStatus("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("listExports", () => {
    it("should return empty array when no exports", async () => {
      exportHistoryQuery.offset.mockResolvedValue([]);
      exportHistoryQuery.count.mockReturnValue({
        first: vi.fn(async () => ({ count: 0 })),
      });

      const result = await exportService.listExports("user123", {
        page: 1,
        limit: 20,
      });

      expect(Array.isArray(result.exports)).toBe(true);
      expect(result.exports).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});
