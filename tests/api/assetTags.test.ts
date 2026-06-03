import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

const assetTagServiceMocks = vi.hoisted(() => ({
  getAllTags: vi.fn(),
  getTagById: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  bulkAssignTags: vi.fn(),
  getTagsForAsset: vi.fn(),
  assignTagToAsset: vi.fn(),
  unassignTagFromAsset: vi.fn(),
}));

vi.mock("../../src/services/assetTag.service.js", () => {
  return {
    assetTagService: {
      getAllTags: assetTagServiceMocks.getAllTags,
      getTagById: assetTagServiceMocks.getTagById,
      createTag: assetTagServiceMocks.createTag,
      updateTag: assetTagServiceMocks.updateTag,
      deleteTag: assetTagServiceMocks.deleteTag,
      bulkAssignTags: assetTagServiceMocks.bulkAssignTags,
      getTagsForAsset: assetTagServiceMocks.getTagsForAsset,
      assignTagToAsset: assetTagServiceMocks.assignTagToAsset,
      unassignTagFromAsset: assetTagServiceMocks.unassignTagFromAsset,
    },
  };
});

describe("Asset Tags API", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.API_KEY_BOOTSTRAP_TOKEN = "bootstrap-secret";
    const { buildServer } = await import("../../src/index.js");
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    assetTagServiceMocks.getTagById.mockResolvedValue(null);
  });

  describe("GET /api/v1/assets/tags", () => {
    it("should list all tags", async () => {
      const mockTags = [{ id: "1", name: "stablecoin", color: "#00FF00" }];
      assetTagServiceMocks.getAllTags.mockResolvedValueOnce(mockTags);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets/tags",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ tags: mockTags });
      expect(assetTagServiceMocks.getAllTags).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /api/v1/assets/tags", () => {
    it("should reject creation without auth", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/assets/tags",
        payload: { name: "test-tag" },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should create a tag when authorized", async () => {
      const mockTag = { id: "1", name: "test-tag", color: "#FF0000" };
      assetTagServiceMocks.createTag.mockResolvedValueOnce(mockTag);

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/assets/tags",
        headers: { "x-api-key": "bootstrap-secret" },
        payload: { name: "test-tag", color: "#FF0000" },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toEqual(mockTag);
      expect(assetTagServiceMocks.createTag).toHaveBeenCalledWith(
        "test-tag",
        "#FF0000",
        "Bootstrap admin token",
        "system"
      );
    });
  });

  describe("GET /api/v1/assets/tags/:id", () => {
    it("should return 404 when tag not found", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets/tags/nonexistent",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return tag details when found", async () => {
      const mockTag = { id: "1", name: "stablecoin", color: "#00FF00" };
      assetTagServiceMocks.getTagById.mockResolvedValueOnce(mockTag);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets/tags/1",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual(mockTag);
      expect(assetTagServiceMocks.getTagById).toHaveBeenCalledWith("1");
    });
  });

  describe("PUT /api/v1/assets/tags/:id", () => {
    it("should update tag details when authorized", async () => {
      const mockTag = { id: "1", name: "stablecoin-updated", color: "#0000FF" };
      assetTagServiceMocks.updateTag.mockResolvedValueOnce(mockTag);

      const response = await server.inject({
        method: "PUT",
        url: "/api/v1/assets/tags/1",
        headers: { "x-api-key": "bootstrap-secret" },
        payload: { name: "stablecoin-updated", color: "#0000FF" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual(mockTag);
      expect(assetTagServiceMocks.updateTag).toHaveBeenCalledWith(
        "1",
        { name: "stablecoin-updated", color: "#0000FF" },
        "Bootstrap admin token",
        "system"
      );
    });
  });

  describe("DELETE /api/v1/assets/tags/:id", () => {
    it("should delete tag when authorized", async () => {
      assetTagServiceMocks.deleteTag.mockResolvedValueOnce(undefined);

      const response = await server.inject({
        method: "DELETE",
        url: "/api/v1/assets/tags/1",
        headers: { "x-api-key": "bootstrap-secret" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ success: true, message: "Tag deleted successfully" });
      expect(assetTagServiceMocks.deleteTag).toHaveBeenCalledWith("1", "Bootstrap admin token", "system");
    });
  });

  describe("POST /api/v1/assets/tags/bulk-assign", () => {
    it("should bulk assign tags when authorized", async () => {
      const mockResult = { assignedCount: 2, assetsProcessed: 2, tagsProcessed: 1 };
      assetTagServiceMocks.bulkAssignTags.mockResolvedValueOnce(mockResult);

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/assets/tags/bulk-assign",
        headers: { "x-api-key": "bootstrap-secret" },
        payload: { assetSymbols: ["USDC", "USDT"], tagNames: ["stablecoin"] },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ success: true, ...mockResult });
      expect(assetTagServiceMocks.bulkAssignTags).toHaveBeenCalledWith(
        ["USDC", "USDT"],
        ["stablecoin"],
        "Bootstrap admin token",
        "system"
      );
    });
  });

  describe("GET /api/v1/assets/:symbol/tags", () => {
    it("should get tags for a specific asset", async () => {
      const mockTags = [{ id: "1", name: "stablecoin", color: "#00FF00" }];
      assetTagServiceMocks.getTagsForAsset.mockResolvedValueOnce(mockTags);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/assets/USDC/tags",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ symbol: "USDC", tags: mockTags });
      expect(assetTagServiceMocks.getTagsForAsset).toHaveBeenCalledWith("USDC");
    });
  });

  describe("POST /api/v1/assets/:symbol/tags", () => {
    it("should assign tag to asset symbol when authorized", async () => {
      const mockTags = [{ id: "1", name: "stablecoin", color: "#00FF00" }];
      assetTagServiceMocks.assignTagToAsset.mockResolvedValueOnce(undefined);
      assetTagServiceMocks.getTagsForAsset.mockResolvedValueOnce(mockTags);

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/assets/USDC/tags",
        headers: { "x-api-key": "bootstrap-secret" },
        payload: { tags: ["stablecoin"] },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ success: true, tags: mockTags });
      expect(assetTagServiceMocks.assignTagToAsset).toHaveBeenCalledWith(
        "USDC",
        "stablecoin",
        "Bootstrap admin token",
        "system"
      );
    });
  });

  describe("DELETE /api/v1/assets/:symbol/tags/:tagName", () => {
    it("should unassign tag from asset symbol when authorized", async () => {
      assetTagServiceMocks.unassignTagFromAsset.mockResolvedValueOnce(undefined);

      const response = await server.inject({
        method: "DELETE",
        url: "/api/v1/assets/USDC/tags/stablecoin",
        headers: { "x-api-key": "bootstrap-secret" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ success: true, message: 'Tag "stablecoin" unassigned from asset "USDC"' });
      expect(assetTagServiceMocks.unassignTagFromAsset).toHaveBeenCalledWith(
        "USDC",
        "stablecoin",
        "Bootstrap admin token",
        "system"
      );
    });
  });
});
