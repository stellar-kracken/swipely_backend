import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetMetadataSyncService } from "../../src/services/assetMetadataSync.service.js";
import type { MetadataSourceAdapter } from "../../src/services/sources/assetMetadataSync.types.js";

const {
  insertMock,
  updateMock,
  orderByMock,
  firstMock,
  upsertMetadataMock,
  getMetadataMock,
  validateMetadataMock,
  setManualOverrideMock,
} = vi.hoisted(() => ({
  insertMock: vi.fn().mockResolvedValue(undefined),
  updateMock: vi.fn().mockResolvedValue(1),
  orderByMock: vi.fn(),
  firstMock: vi.fn(),
  upsertMetadataMock: vi.fn(),
  getMetadataMock: vi.fn(),
  validateMetadataMock: vi.fn(),
  setManualOverrideMock: vi.fn(),
}));

const dbMock = vi.fn((table: string) => {
  if (table === "assets") {
    return {
      select: vi.fn().mockReturnThis(),
      modify: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([
        { id: "asset-1", symbol: "USDC" },
      ]),
    };
  }

  if (table === "asset_metadata_sync_runs") {
    return {
      insert: insertMock,
      where: vi.fn().mockReturnThis(),
      orderBy: orderByMock.mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
  }

  if (table === "asset_metadata") {
    return {
      where: vi.fn().mockReturnThis(),
      update: updateMock,
      first: firstMock,
    };
  }

  return {
    where: vi.fn().mockReturnThis(),
    update: updateMock,
    insert: insertMock,
    first: firstMock,
  };
});

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => dbMock,
}));

vi.mock("../../src/services/assetMetadata.service.js", () => ({
  assetMetadataService: {
    getMetadata: getMetadataMock,
    upsertMetadata: upsertMetadataMock,
    validateMetadata: validateMetadataMock,
    setManualOverride: setManualOverrideMock,
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("AssetMetadataSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateMetadataMock.mockReturnValue({ valid: true, errors: [] });
    getMetadataMock.mockResolvedValue({
      id: "meta-1",
      asset_id: "asset-1",
      symbol: "USDC",
      version: 2,
      social_links: {},
      token_specifications: {},
      tags: [],
      manual_override: false,
    });
    upsertMetadataMock.mockResolvedValue({ version: 3 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => "image/png",
      },
    }));
  });

  it("skips sync when manual override is enabled and force=false", async () => {
    getMetadataMock.mockResolvedValueOnce({
      id: "meta-1",
      asset_id: "asset-1",
      symbol: "USDC",
      version: 2,
      social_links: {},
      token_specifications: {},
      tags: [],
      manual_override: true,
    });

    const adapter: MetadataSourceAdapter = {
      source: "test-source",
      supports: () => true,
      fetch: async () => ({
        source: "test-source",
        confidence: 1,
        data: { description: "new" },
      }),
    };

    const service = new AssetMetadataSyncService([adapter]);
    const result = await service.syncSingleAsset({
      assetId: "asset-1",
      symbol: "USDC",
      force: false,
    });

    expect(result.status).toBe("skipped");
    expect(upsertMetadataMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalled();
  });

  it("applies selective refresh fields from source data", async () => {
    const adapter: MetadataSourceAdapter = {
      source: "test-source",
      supports: () => true,
      fetch: async () => ({
        source: "test-source",
        confidence: 0.8,
        data: {
          description: "updated description",
          website_url: "https://issuer.example",
          category: "Stablecoin",
        },
      }),
    };

    const service = new AssetMetadataSyncService([adapter]);

    const result = await service.syncSingleAsset({
      assetId: "asset-1",
      symbol: "USDC",
      fields: ["description", "website_url"],
      force: true,
      triggeredBy: "test-suite",
    });

    expect(result.status).toBe("success");
    expect(upsertMetadataMock).toHaveBeenCalledWith(
      "asset-1",
      "USDC",
      expect.objectContaining({
        description: "updated description",
        website_url: "https://issuer.example",
      }),
      "test-suite",
    );
    expect(upsertMetadataMock).not.toHaveBeenCalledWith(
      "asset-1",
      "USDC",
      expect.objectContaining({ category: "Stablecoin" }),
      "test-suite",
    );
  });

  it("tracks conflicts when two sources disagree", async () => {
    const first: MetadataSourceAdapter = {
      source: "source-a",
      supports: () => true,
      fetch: async () => ({
        source: "source-a",
        confidence: 0.9,
        data: { website_url: "https://a.example" },
      }),
    };

    const second: MetadataSourceAdapter = {
      source: "source-b",
      supports: () => true,
      fetch: async () => ({
        source: "source-b",
        confidence: 0.7,
        data: { website_url: "https://b.example" },
      }),
    };

    const service = new AssetMetadataSyncService([first, second]);
    const result = await service.syncSingleAsset({
      assetId: "asset-1",
      symbol: "USDC",
      force: true,
      fields: ["website_url"],
    });

    expect(result.status).toBe("success");
    expect(result.conflicts).toContain("website_url");
    expect(upsertMetadataMock).toHaveBeenCalledWith(
      "asset-1",
      "USDC",
      expect.objectContaining({ website_url: "https://a.example" }),
      "system",
    );
  });
});
