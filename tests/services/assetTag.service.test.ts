import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDatabase } from "../../src/database/connection.js";
import { AssetTagService } from "../../src/services/assetTag.service.js";

// Mock the database connection inside the factory
vi.mock("../../src/database/connection.js", () => {
  const mockDbQuery = {
    select: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    first: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    ignore: vi.fn().mockReturnThis(),
    join: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
  };

  const mockDb = vi.fn().mockImplementation((table: string) => {
    return mockDbQuery;
  });

  mockDbQuery.transaction.mockImplementation(async (cb) => {
    return cb(mockDb);
  });

  return {
    getDatabase: () => mockDb,
  };
});

// Mock audit logging
vi.mock("../../src/services/audit.service.js", () => ({
  auditService: {
    log: vi.fn().mockResolvedValue({}),
  },
}));

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("AssetTagService", () => {
  let service: AssetTagService;
  let mockDb: any;
  let mockDbQuery: any;

  beforeEach(() => {
    service = new AssetTagService();
    vi.clearAllMocks();

    mockDb = getDatabase();
    mockDbQuery = mockDb();

    // Reset query builders to default return values
    mockDbQuery.select.mockReturnThis();
    mockDbQuery.orderBy.mockReturnThis();
    mockDbQuery.where.mockReturnThis();
    mockDbQuery.whereIn.mockReturnThis();
    mockDbQuery.first.mockResolvedValue(undefined);
    
    // insert and update should return the query builder mockDbQuery to allow chaining .returning()
    mockDbQuery.insert.mockReturnValue(mockDbQuery);
    mockDbQuery.update.mockReturnValue(mockDbQuery);
    
    mockDbQuery.returning.mockResolvedValue([]);
    mockDbQuery.onConflict.mockReturnValue(mockDbQuery);
    mockDbQuery.ignore.mockResolvedValue([]);
    mockDbQuery.delete.mockResolvedValue(1);
    mockDbQuery.join.mockReturnThis();
  });

  describe("createTag", () => {
    it("should successfully create a new tag", async () => {
      const mockTag = { id: "123", name: "test-tag", color: "#FF0000" };
      mockDbQuery.first.mockResolvedValue(undefined); // No duplicate
      mockDbQuery.returning.mockResolvedValue([mockTag]);

      const result = await service.createTag("test-tag", "#FF0000", "admin-1");

      expect(result).toEqual(mockTag);
      expect(mockDb).toHaveBeenCalledWith("tags");
    });

    it("should throw an error if tag name is empty", async () => {
      await expect(service.createTag("", null, "admin-1")).rejects.toThrow("Tag name is required");
    });

    it("should throw an error if tag already exists", async () => {
      mockDbQuery.first.mockResolvedValue({ id: "123", name: "exists" });
      await expect(service.createTag("exists", null, "admin-1")).rejects.toThrow("already exists");
    });
  });

  describe("updateTag", () => {
    it("should update an existing tag's color", async () => {
      const existingTag = { id: "123", name: "tag", color: "#000" };
      const updatedTag = { id: "123", name: "tag", color: "#FFF" };

      mockDbQuery.first.mockResolvedValue(existingTag);
      mockDbQuery.returning.mockResolvedValue([updatedTag]);

      const result = await service.updateTag("123", { color: "#FFF" }, "admin-1");

      expect(result.color).toBe("#FFF");
    });

    it("should throw an error if updating a tag that doesn't exist", async () => {
      mockDbQuery.first.mockResolvedValue(undefined);
      await expect(service.updateTag("nonexistent", { name: "new" }, "admin-1")).rejects.toThrow("not found");
    });
  });

  describe("deleteTag", () => {
    it("should delete an existing tag", async () => {
      mockDbQuery.first.mockResolvedValue({ id: "123", name: "delete-me" });
      mockDbQuery.delete.mockResolvedValue(1);

      await expect(service.deleteTag("123", "admin-1")).resolves.not.toThrow();
    });

    it("should throw an error if tag to delete doesn't exist", async () => {
      mockDbQuery.first.mockResolvedValue(undefined);
      await expect(service.deleteTag("nonexistent", "admin-1")).rejects.toThrow("not found");
    });
  });

  describe("assignTagToAsset", () => {
    it("should assign tag to asset successfully", async () => {
      const mockAsset = { id: "asset-1", symbol: "USDC" };
      const mockTag = { id: "tag-1", name: "stablecoin" };

      // Mock finding the asset and tag
      mockDbQuery.first
        .mockResolvedValueOnce(mockAsset) // AssetModel.findBySymbol
        .mockResolvedValueOnce(mockTag);   // TagModel.findByName

      await expect(service.assignTagToAsset("USDC", "stablecoin", "admin-1")).resolves.not.toThrow();
    });

    it("should throw an error if asset to assign tag to is not found", async () => {
      mockDbQuery.first.mockResolvedValue(undefined);
      await expect(service.assignTagToAsset("INVALID", "stablecoin", "admin-1")).rejects.toThrow("not found");
    });
  });
});
