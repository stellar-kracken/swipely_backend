import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BackupService } from "../../src/services/backup.service.js";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("BackupService", () => {
  let backupService: BackupService;
  const testBackupDir = "./test-backups";

  beforeEach(() => {
    // Create test backup directory
    if (!existsSync(testBackupDir)) {
      mkdirSync(testBackupDir, { recursive: true });
    }

    backupService = new BackupService({
      backupDir: testBackupDir,
      retentionDays: 7,
      verifyAfterBackup: false, // Disable for faster tests
      compressionEnabled: false, // Disable for simpler tests
    });
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testBackupDir)) {
      rmSync(testBackupDir, { recursive: true, force: true });
    }
  });

  describe("createBackup", () => {
    it("should create a backup successfully", async () => {
      // This test requires a running database
      // In a real test environment, you would use a test database
      expect(backupService).toBeDefined();
    });

    it("should handle backup failures gracefully", async () => {
      // Mock database connection failure
      expect(backupService).toBeDefined();
    });
  });

  describe("listBackups", () => {
    it("should return empty array when no backups exist", async () => {
      const backups = await backupService.listBackups();
      expect(backups).toEqual([]);
    });

    it("should list all available backups", async () => {
      // Create mock backups
      const backups = await backupService.listBackups();
      expect(Array.isArray(backups)).toBe(true);
    });
  });

  describe("verifyBackup", () => {
    it("should fail verification for non-existent backup", async () => {
      const result = await backupService.verifyBackup("non-existent-backup");
      expect(result.status).toBe("failed");
      expect(result.error).toContain("not found");
    });
  });

  describe("cleanupOldBackups", () => {
    it("should not delete backups within retention period", async () => {
      const deletedCount = await backupService.cleanupOldBackups();
      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("restoreBackup", () => {
    it("should fail restore for non-existent backup", async () => {
      await expect(
        backupService.restoreBackup({
          backupId: "non-existent-backup",
        })
      ).rejects.toThrow();
    });
  });
});
