import { redis } from "../../src/utils/redis.js";

export async function flushRedis(): Promise<void> {
  await (redis as any).flushdb();
}
