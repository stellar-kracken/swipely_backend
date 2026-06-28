import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAuditRetentionJob } from "../../src/jobs/auditRetention.job.js";
import { auditService } from "../../src/services/audit.service.js";

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the auditService
vi.mock("../../src/services/audit.service.js", () => ({
  auditService: {
    applyRetentionPolicy: vi.fn(),
  },
}));

describe("runAuditRetentionJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should execute the retention job with default retention days", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    
    // Mock the cleanup to return 50 deleted records
    vi.mocked(auditService.applyRetentionPolicy).mockResolvedValueOnce(50);

    await runAuditRetentionJob();

    // Verify it called applyRetentionPolicy with default 90 days
    expect(auditService.applyRetentionPolicy).toHaveBeenCalledTimes(1);
    expect(auditService.applyRetentionPolicy).toHaveBeenCalledWith(90);

    // Verify logging behavior
    expect(logger.info).toHaveBeenCalledWith(
      { retentionDays: 90 }, 
      "Running audit log retention job"
    );
    expect(logger.info).toHaveBeenCalledWith(
      { deleted: 50, retentionDays: 90 }, 
      "Audit log retention job complete"
    );
  });

  it("should execute the retention job with custom retention days", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    
    vi.mocked(auditService.applyRetentionPolicy).mockResolvedValueOnce(120);

    await runAuditRetentionJob(30);

    expect(auditService.applyRetentionPolicy).toHaveBeenCalledTimes(1);
    expect(auditService.applyRetentionPolicy).toHaveBeenCalledWith(30);

    expect(logger.info).toHaveBeenCalledWith(
      { deleted: 120, retentionDays: 30 }, 
      "Audit log retention job complete"
    );
  });

  it("should handle edge case when no records are deleted", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    
    vi.mocked(auditService.applyRetentionPolicy).mockResolvedValueOnce(0);

    await runAuditRetentionJob(60);

    expect(auditService.applyRetentionPolicy).toHaveBeenCalledWith(60);
    expect(logger.info).toHaveBeenCalledWith(
      { deleted: 0, retentionDays: 60 }, 
      "Audit log retention job complete"
    );
  });

  it("should handle execution failures and log the error", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    
    const dbError = new Error("Database connection failed");
    vi.mocked(auditService.applyRetentionPolicy).mockRejectedValueOnce(dbError);

    await expect(runAuditRetentionJob(90)).rejects.toThrow("Database connection failed");

    expect(auditService.applyRetentionPolicy).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      { error: dbError }, 
      "Audit log retention job failed"
    );
  });
});
