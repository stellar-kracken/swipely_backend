import { redis } from "./redis.js";

export async function acquireLock(params: {
  key: string;
  value: string;
  ttlMs: number;
}): Promise<boolean> {
  const res = await redis.set(params.key, params.value, "PX", params.ttlMs, "NX");
  return res === "OK";
}

export async function releaseLock(params: {
  key: string;
  value: string;
}): Promise<boolean> {
  const lua = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  const deleted = await redis.eval(lua, 1, params.key, params.value);
  return Number(deleted) === 1;
}

