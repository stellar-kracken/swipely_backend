// Re-export comprehensive rate limiting utilities from the new middleware.
// Per-route overrides are now handled automatically via endpoint-category
// multipliers inside rateLimit.middleware.ts.
export {
  registerRateLimiting,
  getRateLimitMetrics,
  TIER_LIMITS,
} from "./rateLimit.middleware.js";
export type {
  RateLimitTier,
  EndpointCategory,
  TierLimits,
  RateLimitResult,
  RateLimitMetrics,
} from "./rateLimit.middleware.js";
