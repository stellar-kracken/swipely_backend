import { beforeAll, afterAll, vi } from "vitest";

// Mock ioredis globally to prevent test leaks
vi.mock("ioredis", () => {
  return {
    default: class RedisMock {
      on = vi.fn().mockReturnThis();
      get = vi.fn().mockResolvedValue(null);
      set = vi.fn().mockResolvedValue("OK");
      quit = vi.fn().mockResolvedValue(null);
      disconnect = vi.fn().mockResolvedValue(null);
      del = vi.fn().mockResolvedValue(0);
      keys = vi.fn().mockResolvedValue([]);
      incr = vi.fn().mockResolvedValue(0);
      decr = vi.fn().mockResolvedValue(0);
      incrby = vi.fn().mockResolvedValue(0);
      decrby = vi.fn().mockResolvedValue(0);
      expire = vi.fn().mockResolvedValue(1);
      ttl = vi.fn().mockResolvedValue(-1);
      pttl = vi.fn().mockResolvedValue(-1);
      exists = vi.fn().mockResolvedValue(0);
      type = vi.fn().mockResolvedValue("none");
      mget = vi.fn().mockResolvedValue([]);
      mset = vi.fn().mockResolvedValue("OK");
    }
  };
});

// Global test setup
beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.POSTGRES_HOST = "localhost";
  process.env.POSTGRES_PORT = "5432";
  process.env.POSTGRES_DB = "bridge_watch_test";
  process.env.POSTGRES_USER = "bridge_watch";
  process.env.POSTGRES_PASSWORD = "test_password";
  process.env.REDIS_HOST = "localhost";
  process.env.REDIS_PORT = "6379";
});

afterAll(async () => {
  // Cleanup resources
});
