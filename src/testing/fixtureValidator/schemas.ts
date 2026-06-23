import { z } from "zod";

export const AssetSchema = z
  .object({
    symbol: z.string().min(1),
    name: z.string().min(1),
    sourceChain: z.string().min(1).optional(),
    issuerAddress: z.string().min(1).optional(),
  })
  .strict();

export const HealthFactorsSchema = z
  .object({
    liquidityDepth: z.number(),
    priceStability: z.number(),
    bridgeUptime: z.number(),
    reserveBacking: z.number(),
    volumeTrend: z.number(),
  })
  .strict();

export const HealthTrendSchema = z.enum(["improving", "stable", "deteriorating"]);

export const HealthScoreSchema = z
  .object({
    symbol: z.string().min(1),
    overallScore: z.number(),
    factors: HealthFactorsSchema,
    trend: HealthTrendSchema,
    lastUpdated: z.string().min(1),
  })
  .strict();

export const BridgeStatusSchema = z.enum(["healthy", "degraded", "down", "unknown"]);

export const BridgeSchema = z
  .object({
    name: z.string().min(1),
    status: BridgeStatusSchema,
    totalValueLocked: z.number(),
    supplyOnStellar: z.number(),
    supplyOnSource: z.number(),
    mismatchPercentage: z.number(),
  })
  .strict();

export const AssetsFixtureSchema = z
  .object({
    assets: z.array(AssetSchema),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const BridgesFixtureSchema = z
  .object({
    bridges: z.array(BridgeSchema),
  })
  .strict();

export const AssetHealthFixtureSchema = z.record(z.string(), HealthScoreSchema);
