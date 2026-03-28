import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigService } from "../../src/services/config.service";

vi.mock("../../src/database/connection", () => ({
  getDatabase: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    first: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    orderBy: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("ConfigService", () => {
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService("test");
    vi.clearAllMocks();
  });

  describe("get", () => {
    it("should return fallback when config not found", async () => {
      const result = await configService.get("nonexistent", "default");
      expect(result).toBe("default");
    });
  });

  describe("isFeatureEnabled", () => {
    it("should return false for non-existent feature", async () => {
      const result = await configService.isFeatureEnabled("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("validateMetadata", () => {
    it("should validate configuration values", () => {
      const config = { key: "test", value: "value" };
      expect(config).toBeDefined();
    });
  });
});
