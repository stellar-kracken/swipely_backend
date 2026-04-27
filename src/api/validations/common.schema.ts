import { z } from "zod";
import { coercion } from "../../utils/validation.js";

/**
 * Common pagination schema
 */
export const PaginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
    page: z.coerce.number().int().min(1).optional().default(1),
});

/**
 * Asset symbol schema
 */
export const AssetSymbolSchema = z.string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9/]+$/, "Invalid asset symbol format");

/**
 * Period schema
 */
export const PeriodSchema = z.enum(["24h", "7d", "30d", "1y"]).optional().default("7d");
