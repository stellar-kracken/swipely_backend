import { describe, it, expect, vi, beforeEach } from "vitest";
import { SourceNormalizationService, adapterRegistry, type ProviderAdapter } from "../../src/services/sourceNormalization.service.js";

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock database
const mockInsert = vi.fn().mockResolvedValue([1]);
const mockDb = vi.fn().mockReturnValue({
  insert: mockInsert,
});

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockDb,
}));

// Create a dummy adapter for testing mapping and conflicts
class TestAdapter implements ProviderAdapter {
  provider = "test_provider";
  version = "v1";

  validate(payload: unknown): boolean {
    const data = payload as Record<string, unknown>;
    return typeof data.asset === "string" && typeof data.value === "number";
  }

  normalize(payload: unknown) {
    const data = payload as Record<string, unknown>;
    
    if (data.value === -1) {
      throw new Error("Invalid negative value during normalization");
    }

    return {
      id: "test-id-123",
      provider: this.provider,
      version: this.version,
      assetCode: String(data.asset),
      assetIssuer: "native",
      amount: Number(data.value),
      timestamp: new Date("2026-06-28T00:00:00Z"),
      raw: { original: data }
    };
  }
}

describe("SourceNormalizationService", () => {
  let service: SourceNormalizationService;

  beforeAll(() => {
    // Register the test adapter
    adapterRegistry.register(new TestAdapter());
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = SourceNormalizationService.getInstance();
  });

  it("should successfully normalize a valid payload", async () => {
    const payload = {
      asset: "USDC",
      value: 100.5,
      extra: "info"
    };

    const result = await service.normalize("test_provider", "v1", payload);

    expect(result.provider).toBe("test_provider");
    expect(result.version).toBe("v1");
    expect(result.assetCode).toBe("USDC");
    expect(result.amount).toBe(100.5);
    expect(result.raw).toEqual({ original: payload });

    // Verify it was persisted to DB
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: "test-id-123",
      provider: "test_provider",
      version: "v1",
      asset_code: "USDC",
      amount: 100.5,
    }));
  });

  it("should successfully normalize stellar payloads using the built-in adapter", async () => {
    const payload = {
      asset_code: "EURC",
      asset_issuer: "GEURC",
      amount: 500,
      timestamp: "2026-06-28T12:00:00Z",
      memo: "test-tx"
    };

    const result = await service.normalize("stellar", "v1", payload);

    expect(result.provider).toBe("stellar");
    expect(result.assetCode).toBe("EURC");
    expect(result.assetIssuer).toBe("GEURC");
    expect(result.amount).toBe(500);
    // Extra fields should be moved to raw
    expect(result.raw).toEqual({ memo: "test-tx" });
  });

  it("should reject payload if validation fails", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    
    const invalidPayload = {
      asset: "USDC",
      value: "100" // Should be a number for our TestAdapter
    };

    await expect(service.normalize("test_provider", "v1", invalidPayload))
      .rejects.toThrow("Payload validation failed for provider='test_provider' version='v1'");
    
    expect(logger.error).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("should throw if no adapter is registered for provider", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    
    await expect(service.normalize("unknown_provider", "v1", {}))
      .rejects.toThrow("No adapter registered for provider='unknown_provider' version='v1'");
      
    expect(logger.error).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("should handle normalization errors from the adapter", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    
    const conflictingPayload = {
      asset: "USDC",
      value: -1 // Triggers error in TestAdapter.normalize
    };

    await expect(service.normalize("test_provider", "v1", conflictingPayload))
      .rejects.toThrow(/Adapter normalization error for provider='test_provider' version='v1'/);
      
    expect(logger.error).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("should warn when registering a duplicate adapter", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    
    // Registering the same test adapter again
    adapterRegistry.register(new TestAdapter());
    
    expect(logger.warn).toHaveBeenCalledWith(
      { provider: "test_provider", version: "v1" },
      "Adapter already registered – overwriting"
    );
  });
});
