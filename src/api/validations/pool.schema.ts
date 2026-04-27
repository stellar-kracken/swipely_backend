import { z } from "zod";
import { AssetSymbolSchema } from "./common.schema.js";

export const PoolIdParamsSchema = z.object({
  poolId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "Invalid pool ID format"),
});

export const AssetPairParamsSchema = z.object({
  assetA: AssetSymbolSchema,
  assetB: AssetSymbolSchema,
});

export const PoolEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
});

export const LargeLiquidityEventsQuerySchema = z.object({
  threshold: z.coerce.number().min(0).max(1).optional().default(0.1),
});
