import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssetMetadataService } from "../../src/services/assetMetadata.service";

vi.mock("../../src/database/connection", () => ({
  getDatabase: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    orderBy: vi.fn().mockReturnThis(),
    orWhere: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("AssetMetadataService", () => {
  let assetMetadataService: AssetMetadataService;

  beforeEach(() => {
    assetMetadataService = new AssetMetadataService();
    vi.clearAllMocks();
  });

  describe("getMetadata", () => {
    it("should return null when metadata not found", async () => {
      const result = await assetMetadataService.getMetadata("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getMetadataBySymbol", () => {
    it("should return null when metadata not found", async () => {
      const result =
        await assetMetadataService.getMetadataBySymbol("NONEXISTENT");
      expect(result).toBeNull();
    });
  });

  describe("validateMetadata", () => {
    it("should validate valid metadata", () => {
      const metadata = {
        website_url: "https://example.com",
        logo_url: "https://example.com/logo.png",
      };
      const result = assetMetadataService.validateMetadata(metadata);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid URLs", () => {
      const metadata = {
        website_url: "not-a-url",
      };
      const result = assetMetadataService.validateMetadata(metadata);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("getAllMetadata", () => {
    it("should return empty array when no metadata", async () => {
      const result = await assetMetadataService.getAllMetadata();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
