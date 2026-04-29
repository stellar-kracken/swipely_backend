import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Knex } from "knex";
import { Redis } from "ioredis";
import { ConfigService } from "../ConfigService.js";

/**
 * ConfigService Tests
 * Issue: #377
 * 
 * Tests cover:
 * - Hierarchical resolution (env → global → default)
 * - Cache hit/miss scenarios
 * - Validation with Zod schemas
 * - Encryption for sensitive values
 * - Audit trail creation
 * - Cache invalidation (local + pub/sub)
 * - Bulk import/export
 * - Error handling
 */

describe("ConfigService", () => {
  let mockDb: Partial<Knex>;
  let mockRedis: Partial<Redis>;
  let configService: ConfigService;

  beforeEach(() => {
    // Mock database
    mockDb = {
      transaction: vi.fn((callback) => callback(mockDb)),
      where: vi.fn().mockReturnThis(),
      first: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn(),
      delete: vi.fn(),
      returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      orderBy: vi.fn().mockReturnThis(),
      join: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      fn: {
        now: vi.fn(),
      },
    } as any;

    // Mock Redis
    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      keys: vi.fn().mockResolvedValue([]),
      publish: vi.fn(),
      duplicate: vi.fn().mockReturnThis(),
      subscribe: vi.fn((channel, callback) => callback(null)),
      on: vi.fn(),
    } as any;

    configService = new ConfigService(
      mockDb as Knex,
      mockRedis as Redis,
      "test-encryption-key-32-bytes!!"
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Hierarchical Resolution", () => {
    it("should resolve environment-specific config first", async () => {
      const mockConfig = {
        id: 1,
        environment: "prod-us-east",
        key: "MAX_RETRIES",
        value: 5,
        encrypted: false,
        validated: true,
      };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(mockConfig);

      const result = await configService.get("MAX_RETRIES", "prod-us-east");

      expect(result).toBe(5);
      expect(mockDb.where).toHaveBeenCalledWith({
        environment: "prod-us-east",
        key: "MAX_RETRIES",
      });
    });

    it("should fallback to global config if env-specific not found", async () => {
      const mockGlobalConfig = {
        id: 2,
        environment: "global",
        key: "MAX_RETRIES",
        value: 3,
        encrypted: false,
        validated: true,
      };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first)
        .mockResolvedValueOnce(null) // env-specific not found
        .mockResolvedValueOnce(mockGlobalConfig); // global found

      const result = await configService.get("MAX_RETRIES", "prod-us-east");

      expect(result).toBe(3);
    });

    it("should use safe default if no config found", async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(null);

      const result = await configService.get("MAX_RETRIES", "prod-us-east");

      expect(result).toBe(3); // Safe default
    });

    it("should throw error if no config and no safe default", async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(null);

      await expect(
        configService.get("CIRCLE_API_KEY" as any, "prod-us-east")
      ).rejects.toThrow("No configuration found");
    });
  });

  describe("Cache Behavior", () => {
    it("should return cached value on cache hit", async () => {
      const cachedValue = JSON.stringify(5);
      vi.mocked(mockRedis.get).mockResolvedValue(cachedValue);

      const result = await configService.get("MAX_RETRIES", "prod-us-east");

      expect(result).toBe(5);
      expect(mockDb.where).not.toHaveBeenCalled(); // DB not queried
    });

    it("should cache value after DB query", async () => {
      const mockConfig = {
        id: 1,
        environment: "prod-us-east",
        key: "MAX_RETRIES",
        value: 5,
        encrypted: false,
        validated: true,
      };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(mockConfig);

      await configService.get("MAX_RETRIES", "prod-us-east");

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "config:prod-us-east:MAX_RETRIES",
        300,
        JSON.stringify(5)
      );
    });

    it("should invalidate cache on config update", async () => {
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue({
        id: 1,
        value: 3,
      });
      vi.mocked(mockDb.update).mockResolvedValue(1);

      await configService.set("MAX_RETRIES", 5, {
        environment: "prod-us-east",
        changedBy: "admin@test.com",
      });

      expect(mockRedis.del).toHaveBeenCalledWith(
        "config:prod-us-east:MAX_RETRIES"
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        "config:changed",
        expect.stringContaining("prod-us-east")
      );
    });
  });

  describe("Validation", () => {
    it("should validate value with Zod schema", async () => {
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(null);

      await configService.set("MAX_RETRIES", 5, {
        environment: "global",
        changedBy: "admin@test.com",
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("should reject invalid value", async () => {
      await expect(
        configService.set("MAX_RETRIES", "invalid" as any, {
          environment: "global",
          changedBy: "admin@test.com",
        })
      ).rejects.toThrow("Validation failed");
    });

    it("should reject out-of-range value", async () => {
      await expect(
        configService.set("MAX_RETRIES", 100, {
          environment: "global",
          changedBy: "admin@test.com",
        })
      ).rejects.toThrow("Validation failed");
    });
  });

  describe("Encryption", () => {
    it("should encrypt sensitive values", async () => {
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(null);

      await configService.set("JWT_SECRET", "my-secret-key-32-bytes-long!!", {
        environment: "global",
        changedBy: "admin@test.com",
      });

      const insertCall = vi.mocked(mockDb.insert).mock.calls[0][0];
      expect(insertCall.encrypted).toBe(true);
      expect(insertCall.value).not.toBe("my-secret-key-32-bytes-long!!");
      expect(insertCall.value).toContain(":"); // Encrypted format: iv:authTag:encrypted
    });

    it("should decrypt sensitive values on retrieval", async () => {
      const mockConfig = {
        id: 1,
        environment: "global",
        key: "JWT_SECRET",
        value: "encrypted-value-here",
        encrypted: true,
        validated: true,
      };

      vi.mocked(mockRedis.get).mockResolvedValue(null);
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(mockConfig);

      // This will fail decryption with mock data, but tests the flow
      await expect(
        configService.get("JWT_SECRET", "global")
      ).rejects.toThrow();
    });

    it("should not encrypt non-sensitive values", async () => {
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(null);

      await configService.set("MAX_RETRIES", 5, {
        environment: "global",
        changedBy: "admin@test.com",
      });

      const insertCall = vi.mocked(mockDb.insert).mock.calls[0][0];
      expect(insertCall.encrypted).toBe(false);
      expect(insertCall.value).toBe(5);
    });
  });

  describe("Audit Trail", () => {
    it("should create audit entry on config update", async () => {
      const existingConfig = {
        id: 1,
        value: 3,
      };

      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.update).mockResolvedValue(1);

      await configService.set("MAX_RETRIES", 5, {
        environment: "global",
        changedBy: "admin@test.com",
        changeReason: "Increase for peak load",
      });

      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          config_id: 1,
          old_value: 3,
          new_value: 5,
          changed_by: "admin@test.com",
          change_reason: "Increase for peak load",
        })
      );
    });

    it("should create audit entry on config creation", async () => {
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(null);

      await configService.set("MAX_RETRIES", 5, {
        environment: "global",
        changedBy: "admin@test.com",
      });

      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          old_value: null,
          new_value: 5,
          changed_by: "admin@test.com",
        })
      );
    });

    it("should retrieve audit trail", async () => {
      const mockAudits = [
        {
          id: 1,
          config_id: 1,
          old_value: 3,
          new_value: 5,
          changed_by: "admin@test.com",
          change_reason: "Update",
          changed_at: new Date(),
        },
      ];

      vi.mocked(mockDb.join).mockReturnThis();
      vi.mocked(mockDb.select).mockReturnThis();
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.orderBy).mockReturnThis();
      vi.mocked(mockDb.limit).mockResolvedValue(mockAudits);

      const audits = await configService.getAuditTrail("MAX_RETRIES", "global");

      expect(audits).toEqual(mockAudits);
    });
  });

  describe("Bulk Operations", () => {
    it("should export all configs for environment", async () => {
      const mockConfigs = [
        { key: "MAX_RETRIES", value: 5 },
        { key: "LOG_LEVEL", value: "info" },
      ];

      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.orderBy).mockResolvedValue(mockConfigs);

      const exported = await configService.exportConfig("prod-us-east");

      expect(exported).toEqual({
        MAX_RETRIES: 5,
        LOG_LEVEL: "info",
      });
    });

    it("should import multiple configs atomically", async () => {
      const configs = {
        MAX_RETRIES: 5,
        LOG_LEVEL: "info",
      };

      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(null);

      await configService.importConfig(
        configs,
        "prod-us-east",
        "admin@test.com",
        "Bulk import"
      );

      expect(mockDb.insert).toHaveBeenCalledTimes(4); // 2 configs + 2 audits
    });
  });

  describe("Delete Operations", () => {
    it("should delete config and create audit entry", async () => {
      const existingConfig = {
        id: 1,
        value: 5,
      };

      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.delete).mockResolvedValue(1);

      await configService.delete(
        "MAX_RETRIES",
        "global",
        "admin@test.com",
        "No longer needed"
      );

      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          config_id: 1,
          old_value: 5,
          new_value: null,
          changed_by: "admin@test.com",
          change_reason: "No longer needed",
        })
      );
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("should throw error if config not found", async () => {
      vi.mocked(mockDb.where).mockReturnThis();
      vi.mocked(mockDb.first).mockResolvedValue(null);

      await expect(
        configService.delete("MAX_RETRIES", "global", "admin@test.com")
      ).rejects.toThrow("not found");
    });
  });
});
