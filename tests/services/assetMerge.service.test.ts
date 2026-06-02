import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetMergeService } from "../../src/services/assetMerge.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const b: Record<string, unknown> = {};
    b.where = vi.fn().mockReturnValue(b);
    b.whereIn = vi.fn().mockReturnValue(b);
    b.orderBy = vi.fn().mockReturnValue(b);
    b.insert = vi.fn().mockReturnValue(b);
    b.update = vi.fn().mockReturnValue(b);
    b.delete = vi.fn().mockResolvedValue(1);
    b.first = vi.fn().mockResolvedValue(null);
    b.returning = vi.fn().mockResolvedValue([]);
    b.limit = vi.fn().mockReturnValue(b);
    const fn = (_t: string) => b;
    return fn;
  }),
}));

describe("AssetMergeService", () => {
  let service: AssetMergeService;

  beforeEach(() => {
    (AssetMergeService as any).instance = undefined;
    service = AssetMergeService.getInstance();
    vi.clearAllMocks();
  });

  describe("findDuplicates", () => {
    it("returns empty array when no duplicates exist", async () => {
      const groups = await service.findDuplicates();
      expect(groups).toEqual([]);
    });
  });

  describe("merge", () => {
    it("throws when primary asset not found", async () => {
      await expect(
        service.merge("nonexistent", ["dup-1"], "ops")
      ).rejects.toThrow("Primary asset not found");
    });
  });

  describe("proposeMerge", () => {
    it("creates a pending review", async () => {
      const review = await service.proposeMerge({
        primaryAssetId: "asset-1",
        primarySymbol: "USDC",
        duplicateIds: ["asset-2"],
        matchScore: 0.9,
        matchReason: "same symbol",
      });

      expect(review.status).toBe("pending");
      expect(review.duplicateGroup.primarySymbol).toBe("USDC");
    });
  });

  describe("getReview", () => {
    it("returns null for unknown review", async () => {
      const review = await service.getReview("nonexistent");
      expect(review).toBeNull();
    });
  });

  describe("listReviews", () => {
    it("returns empty array when no reviews", async () => {
      const reviews = await service.listReviews();
      expect(reviews).toEqual([]);
    });
  });

  describe("getMergeHistory", () => {
    it("returns empty array when no history", async () => {
      const history = await service.getMergeHistory();
      expect(history).toEqual([]);
    });
  });
});
