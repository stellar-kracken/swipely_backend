import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { config } from "../../config/index.js";

/**
 * Register a stricter rate limit on specific route prefixes.
 * The global rate limit is registered in index.ts; this helper
 * allows per-route overrides.
 */
export async function applyStrictRateLimit(server: FastifyInstance) {
  await server.register(rateLimit, {
    max: Math.floor(config.RATE_LIMIT_MAX / 2),
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (request) => {
      return request.ip;
    },
  });
}
