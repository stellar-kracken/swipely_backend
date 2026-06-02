import { z } from "zod";
import { coercion } from "../../utils/validation.js";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "../../utils/pagination.js";

export const PaginationSchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional().default(DEFAULT_PAGE_LIMIT),
    offset: z.coerce.number().int().min(0).optional(),
    cursor: z.string().optional(),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;

export const SortOrderSchema = z.enum(["asc", "desc"]).optional().default("desc");

export const AssetSymbolSchema = z.string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9/]+$/, "Invalid asset symbol format");

export const PeriodSchema = z.enum(["24h", "7d", "30d", "1y"]).optional().default("7d");
