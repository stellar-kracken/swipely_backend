import "tsx/cjs";

process.env.NODE_ENV ||= "test";
process.env.POSTGRES_HOST ||= "localhost";
process.env.POSTGRES_PORT ||= "5432";
process.env.POSTGRES_DB ||= "bridge_watch_test";
process.env.POSTGRES_USER ||= "bridge_watch";
process.env.POSTGRES_PASSWORD ||= "test_password";
process.env.REDIS_HOST ||= "localhost";
process.env.REDIS_PORT ||= "6379";

import { beforeAll, afterAll, vi } from "vitest";

// Mock ioredis globally to prevent test leaks
vi.mock("ioredis", () => {
  class RedisMock {
    private static sortedSetStore = new Map<string, number[]>();

    on = vi.fn().mockReturnThis();
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue("OK");
    quit = vi.fn().mockResolvedValue(null);
    disconnect = vi.fn().mockResolvedValue(null);
    duplicate = vi.fn().mockReturnThis();
    del = vi.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (RedisMock.sortedSetStore.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    });
    keys = vi.fn(async (pattern: string) => {
      const regex = new RegExp("^" + pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*") + "$");
      return Array.from(RedisMock.sortedSetStore.keys()).filter((k) => regex.test(k));
    });
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
    hgetall = vi.fn().mockResolvedValue({});
    hset = vi.fn().mockResolvedValue(0);
    hget = vi.fn().mockResolvedValue(null);
    hdel = vi.fn().mockResolvedValue(0);
    info = vi.fn().mockResolvedValue("used_memory:1000\r\nconnected_clients:1\r\n");
    zcard = vi.fn().mockResolvedValue(0);
    zadd = vi.fn().mockResolvedValue(0);
    zrange = vi.fn().mockResolvedValue([]);
    zrangebyscore = vi.fn().mockResolvedValue([]);
    zremrangebyscore = vi.fn().mockResolvedValue(0);
    pexpire = vi.fn().mockResolvedValue(1);
    setex = vi.fn().mockResolvedValue("OK");
    publish = vi.fn().mockResolvedValue(0);
    subscribe = vi.fn().mockResolvedValue(null);
    unsubscribe = vi.fn().mockResolvedValue(null);
    flushdb = vi.fn().mockResolvedValue("OK");
    flushall = vi.fn().mockResolvedValue("OK");
    eval = vi.fn(async (_script: string, _numKeys: number, key: string, now: string, window: string, limit: string, burst: string) => {
      const nowMs = Number(now);
      const windowMs = Number(window);
      const limitNum = Number(limit);
      const burstNum = Number(burst);
      const effectiveLimit = limitNum + burstNum;

      const existing = RedisMock.sortedSetStore.get(key) ?? [];
      const active = existing.filter((ts) => ts > nowMs - windowMs);

      if (active.length >= effectiveLimit) {
        const oldest = active[0] ?? nowMs;
        const resetMs = oldest + windowMs;
        RedisMock.sortedSetStore.set(key, active);
        return [0, active.length, resetMs, limitNum];
      }

      active.push(nowMs);
      RedisMock.sortedSetStore.set(key, active);
      return [1, active.length, nowMs + windowMs, limitNum];
    });
    pipeline = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
      zadd: vi.fn().mockReturnThis(),
      zremrangebyscore: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      incr: vi.fn().mockReturnThis(),
      incrby: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      setex: vi.fn().mockReturnThis(),
    });
  }
  return {
    default: RedisMock,
    Redis: RedisMock,
    Cluster: RedisMock,
  };
});

import { getDatabase, closeDatabase } from "../../src/database/connection.js";
import { resetDatabase } from "../helpers/db.js";

beforeAll(async () => {
  const db = getDatabase();
  await resetDatabase(db);
});

afterAll(async () => {
  await closeDatabase();
});
