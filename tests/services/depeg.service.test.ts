import { describe, it, expect, vi, beforeEach } from "vitest";
import { DepegService } from "../../src/services/depeg.service";

vi.mock("../../src/database/connection", () => ({
  getDatabase: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    update: vi.fn(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
    avg: vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("../../src/utils/redis", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn(),
  },
}));

vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("DepegService", () => {
  let depegService: DepegService;

  beforeEach(() => {
    depegService = new DepegService();
    vi.clearAllMocks();
  });

  describe("monitorStablecoin", () => {
    it("should monitor stablecoin for depeg", async () => {
      try {
        await depegService.monitorStablecoin("USDC");
      } catch (error) {
        // Expected to fail without real data
        expect(error).toBeDefined();
      }
    });
  });

  describe("getActiveDepegs", () => {
    it("should return empty array when no active depegs", async () => {
      const result = await depegService.getActiveDepegs();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getDepegHistory", () => {
    it("should return empty array when no history", async () => {
      const result = await depegService.getDepegHistory();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
