import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExportService } from "../../src/services/export.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const dbMock = vi.fn((table: string) => {
      if (table === "export_history") {
        return {
          insert: vi.fn(),
          where: vi.fn(),
          first: vi.fn(),
          delete: vi.fn(),
          count: vi.fn(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
        };
      }
      return {};
    }) as any;

    dbMock.fn = {
      now: vi.fn().mockReturnValue("NOW()"),
    };

    return dbMock;
  }),
}));

vi.mock("../../src/workers/export.worker.js", () => ({
  exportQueue: {
    add: vi.fn(),
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    EXPORT_MAX_DATE_RANGE_DAYS: 90,
    EXPORT_DOWNLOAD_URL_EXPIRY_HOURS: 24,
    REDIS_HOST: "localhost",
    REDIS_PORT: 6379,
    LOG_LEVEL: "info",
  },
}));

vi.mock("fs/promises", () => ({
  unlink: vi.fn(),
}));

describe("ExportService", () => {
  let exportService: ExportService;
  let mockDb: any;

  beforeEach(() => {
    exportService = new ExportService();
    mockDb = {
      fn: {
        now: vi.fn().mockReturnValue("NOW()"),
      },
      "export_history": {
        insert: vi.fn(),
        where: vi.fn(),
        first: vi.fn(),
        delete: vi.fn(),
      },
    };
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("requestExport", () => {
    it("creates export record with pending status", async () => {
      const mockRecord = {
        id: "test-export-id",
        requested_by: "user-123",
        format: "csv",
        data_type: "analytics",
        filters: JSON.stringify({ startDate: "2024-01-01", endDate: "2024-01-31" }),
        status: "pending",
        email_delivery: false,
        email_address: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockDb["export_history"].insert).mockResolvedValue([mockRecord]);

      const payload = {
        format: "csv" as const,
        dataType: "analytics" as const,
        filters: { startDate: "2024-01-01", endDate: "2024-01-31" },
      };

      const result = await exportService.requestExport("user-123", payload);

      expect(result.id).toBe("test-export-id");
      expect(result.status).toBe("pending");
      expect(result.format).toBe("csv");
      expect(mockDb["export_history"].insert).toHaveBeenCalled();
    });

    it("enqueues export job after creating record", async () => {
      const mockRecord = {
        id: "test-export-id",
        requested_by: "user-123",
        format: "json",
        data_type: "transactions",
        filters: JSON.stringify({ startDate: "2024-01-01", endDate: "2024-01-31" }),
        status: "pending",
        email_delivery: false,
        email_address: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockDb["export_history"].insert).mockResolvedValue([mockRecord]);

      const payload = {
        format: "json" as const,
        dataType: "transactions" as const,
        filters: { startDate: "2024-01-01", endDate: "2024-01-31" },
      };

      await exportService.requestExport("user-123", payload);

      const { exportQueue } = await import("../../src/workers/export.worker.js");
      expect(exportQueue.add).toHaveBeenCalledWith(
        "process-export",
        expect.objectContaining({
          exportId: "test-export-id",
          requestedBy: "user-123",
          format: "json",
          dataType: "transactions",
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        })
      );
    });

    it("throws error when email delivery requested but no email address", async () => {
      const payload = {
        format: "csv" as const,
        dataType: "analytics" as const,
        filters: { startDate: "2024-01-01", endDate: "2024-01-31" },
        emailDelivery: true,
      };

      await expect(exportService.requestExport("user-123", payload)).rejects.toThrow(
        "Email address required when email delivery is enabled"
      );
    });

    it("validates date range is within maximum allowed days", async () => {
      const payload = {
        format: "csv" as const,
        dataType: "analytics" as const,
        filters: { startDate: "2024-01-01", endDate: "2024-06-01" }, // > 90 days
      };

      await expect(exportService.requestExport("user-123", payload)).rejects.toThrow(
        /Date range exceeds maximum/
      );
    });
  });

  describe("getExportStatus", () => {
    it("returns export record for given ID", async () => {
      const mockRecord = {
        id: "test-export-id",
        requested_by: "user-123",
        format: "csv",
        data_type: "analytics",
        filters: JSON.stringify({ startDate: "2024-01-01", endDate: "2024-01-31" }),
        status: "completed",
        file_path: "/exports/test-export-id.csv",
        download_url: "/api/v1/exports/test-export-id/download",
        download_url_expires_at: new Date(),
        file_size_bytes: 1024,
        is_compressed: false,
        error_message: null,
        email_delivery: false,
        email_address: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockDb["export_history"].where).mockReturnValue({
        first: vi.fn().mockResolvedValue(mockRecord),
      });

      const result = await exportService.getExportStatus("test-export-id");

      expect(result?.id).toBe("test-export-id");
      expect(result?.status).toBe("completed");
      expect(result?.file_path).toBe("/exports/test-export-id.csv");
    });

    it("returns null for non-existent export", async () => {
      vi.mocked(mockDb["export_history"].where).mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
      });

      const result = await exportService.getExportStatus("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("listExports", () => {
    it("returns paginated results for user", async () => {
      const mockRecords = [
        {
          id: "export-1",
          requested_by: "user-123",
          format: "csv",
          data_type: "analytics",
          filters: JSON.stringify({ startDate: "2024-01-01", endDate: "2024-01-31" }),
          status: "completed",
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
        },
        {
          id: "export-2",
          requested_by: "user-123",
          format: "json",
          data_type: "transactions",
          filters: JSON.stringify({ startDate: "2024-02-01", endDate: "2024-02-28" }),
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
        },
      ];

      vi.mocked(mockDb["export_history"].where).mockImplementation((field: string) => {
        if (field === "requested_by") {
          return {
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            offset: vi.fn().mockResolvedValue(mockRecords),
            count: vi.fn().mockResolvedValue({ count: 2 }),
          };
        }
        return { count: vi.fn().mockResolvedValue({ count: 2 }) };
      });

      const result = await exportService.listExports("user-123", { page: 1, limit: 20 });

      expect(result.total).toBe(2);
      expect(result.exports).toHaveLength(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe("generateDownloadUrl", () => {
    it("generates URL with correct expiry", async () => {
      const mockRecord = {
        id: "test-export-id",
        requested_by: "user-123",
        format: "csv",
        data_type: "analytics",
        filters: JSON.stringify({ startDate: "2024-01-01", endDate: "2024-01-31" }),
        status: "completed",
        file_path: "/exports/test-export-id.csv",
        download_url: null,
        download_url_expires_at: null,
        file_size_bytes: 1024,
        is_compressed: false,
        error_message: null,
        email_delivery: false,
        email_address: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      vi.mocked(mockDb["export_history"].where).mockReturnValue({
        first: vi.fn().mockResolvedValue(mockRecord),
        update: vi.fn().mockResolvedValue(1),
      });

      const result = await exportService.generateDownloadUrl("test-export-id");

      expect(result.url).toContain("/api/v1/exports/test-export-id/download");
      expect(result.url).toContain("token=");
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it("throws error for non-completed exports", async () => {
      const mockRecord = {
        id: "test-export-id",
        status: "processing",
        file_path: null,
      };

      vi.mocked(mockDb["export_history"].where).mockReturnValue({
        first: vi.fn().mockResolvedValue(mockRecord),
      });

      await expect(exportService.generateDownloadUrl("test-export-id")).rejects.toThrow(
        "Export is not completed"
      );
    });
  });

  describe("deleteExport", () => {
    it("deletes database record and file", async () => {
      const mockRecord = {
        id: "test-export-id",
        file_path: "/exports/test-export-id.csv",
      };

      vi.mocked(mockDb["export_history"].where).mockReturnValue({
        first: vi.fn().mockResolvedValue(mockRecord),
        delete: vi.fn().mockResolvedValue(1),
      });

      await expect(exportService.deleteExport("test-export-id")).resolves.not.toThrow();

      const fs = await import("fs/promises");
      expect(fs.unlink).toHaveBeenCalledWith("/exports/test-export-id.csv");
      expect(mockDb["export_history"].where().delete).toHaveBeenCalled();
    });

    it("deletes database record even if file doesn't exist", async () => {
      const mockRecord = {
        id: "test-export-id",
        file_path: null,
      };

      vi.mocked(mockDb["export_history"].where).mockReturnValue({
        first: vi.fn().mockResolvedValue(mockRecord),
        delete: vi.fn().mockResolvedValue(1),
      });

      await expect(exportService.deleteExport("test-export-id")).resolves.not.toThrow();
    });
  });
});
