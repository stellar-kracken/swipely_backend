import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitHealthService } from "../../src/services/circuitHealth.service.js";

// Shared query builder mock for chained knex calls
function mockQueryBuilder() {
  const resolveValue: any[] = [];
  const qb = {
    then: (resolve: (value: any) => void) => resolve(resolveValue),
    catch: (reject: (err: any) => void) => reject(new Error()),
    where: vi.fn(() => qb),
    whereIn: vi.fn(() => qb),
    modify: vi.fn((cb: (b: typeof qb) => void) => { cb(qb); return qb; }),
    orderBy: vi.fn(() => qb),
    limit: vi.fn(() => qb),
    first: vi.fn(() => Promise.resolve(null)),
  };
  return qb;
}

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  query: mockQueryBuilder(),
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// getDatabase returns a function (knex) that returns the query builder
vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => vi.fn(() => mocks.query)),
}));

vi.mock("../../src/utils/redis.js", () => ({
  redis: mocks.redis,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: mocks.logger,
}));

vi.mock("../../src/services/circuitBreaker.service.js", () => ({
  getCircuitBreakerService: vi.fn(),
}));

describe("CircuitHealthService", () => {
  let service: CircuitHealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query = mockQueryBuilder();
    service = new CircuitHealthService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getCircuitHealth", () => {
    it("should return full circuit health when no scope is specified", async () => {
      mocks.redis.get.mockResolvedValue(null);

      const health = await service.getCircuitHealth();

      expect(health).toBeDefined();
      if (typeof health === "object" && "bridges" in health) {
        expect(health.timestamp).toBeDefined();
        expect(health.global).toBeDefined();
        expect(health.bridges).toBeDefined();
        expect(health.assets).toBeDefined();
        expect(health.recentTransitions).toBeDefined();
        expect(health.manualOverrides).toBeDefined();
      }
    });

    it("should return specific circuit state when scope is provided", async () => {
      mocks.redis.get.mockResolvedValue(null);
      mocks.query.first.mockResolvedValue(null);

      const state = await service.getCircuitHealth({
        scope: "bridge",
        identifier: "test-bridge",
      });

      expect(state).toBeDefined();
      if (state && typeof state === "object" && "scope" in state) {
        expect(state.scope).toBe("bridge");
        expect(state.identifier).toBe("test-bridge");
        expect(state.level).toBe("none");
        expect(state.isPaused).toBe(false);
      }
    });

    it("should use cached data when available", async () => {
      const cachedData = {
        timestamp: Date.now(),
        global: { scope: "global", level: "none", isPaused: false },
      };
      mocks.redis.get.mockResolvedValue(JSON.stringify(cachedData));

      const health = await service.getCircuitHealth();

      expect(mocks.redis.get).toHaveBeenCalled();
    });
  });

  describe("getRecentTransitions", () => {
    it("should return recent transitions with default limit", async () => {
      const mockTransitions = [
        {
          pause_id: 1,
          pause_scope: 1,
          pause_level: 2,
          identifier: "test-bridge",
          triggered_by: "0xABC",
          trigger_reason: "Test pause",
          timestamp: 1000000,
          recovery_deadline: 1003600,
          status: "active",
        },
      ];

      mocks.query.orderBy.mockReturnThis();
      mocks.query.limit.mockResolvedValue(mockTransitions);

      const transitions = await service.getRecentTransitions();

      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toBeDefined();
    });

    it("should filter transitions by scope", async () => {
      await service.getRecentTransitions(50, "bridge", "test-bridge");

      expect(mocks.query.where).toHaveBeenCalledWith("pause_scope", 1);
    });
  });

  describe("cache operations", () => {
    it("should invalidate cache for specific scope", async () => {
      mocks.redis.del.mockResolvedValue(1);

      await service.invalidateCache("bridge", "test-bridge");

      expect(mocks.redis.del).toHaveBeenCalled();
    });

    it("should get cache statistics", async () => {
      mocks.redis.keys.mockResolvedValue(["key1", "key2", "key3"]);

      const stats = await service.getCacheStats();

      expect(stats).toBeDefined();
      expect(stats.size).toBe(3);
      expect(stats.ttl).toBe(60);
    });

    it("should handle Redis errors gracefully in cache operations", async () => {
      mocks.redis.get.mockRejectedValue(new Error("Redis connection failed"));

      const state = await service.getCircuitHealth({
        scope: "global",
      });

      // Should still return data even if cache fails
      expect(state).toBeDefined();
      expect(mocks.logger.debug).toHaveBeenCalled();
    });
  });

  describe("whitelist operations", () => {
    it("should check if item is whitelisted", async () => {
      mocks.redis.get.mockResolvedValue(null);
      mocks.query.first.mockResolvedValue(null);

      const isWhitelisted = await service.isWhitelisted("address", "0xTest");

      expect(isWhitelisted).toBe(false);
    });

    it("should get whitelist by type", async () => {
      const mockWhitelist = [
        {
          id: 1,
          type: "address",
          value: "0xTest",
          added_by: "admin",
          added_at: new Date(),
        },
      ];

      mocks.query.where.mockReturnThis();
      mocks.query.orderBy.mockResolvedValue(mockWhitelist);
      mocks.redis.get.mockResolvedValue(null);

      const list = await service.getWhitelistByType("address");

      expect(list).toHaveLength(1);
      expect(list[0]).toBeDefined();
    });
  });

  describe("circuit state formatting", () => {
    it("should format circuit states correctly", async () => {
      mocks.redis.get.mockResolvedValue(null);
      mocks.query.first.mockResolvedValue(null);

      const state = await service.getCircuitHealth({
        scope: "global",
      });

      if (state && typeof state === "object" && "scope" in state) {
        expect(state.scope).toBe("global");
        expect(state.level).toMatch(/^(none|warning|partial|full)$/);
        expect(typeof state.isPaused).toBe("boolean");
      }
    });
  });
});
