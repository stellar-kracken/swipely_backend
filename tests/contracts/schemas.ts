import { z } from "zod";

/**
 * Zod schemas describing the public contract of key API responses.
 *
 * These are intentionally independent of the Fastify route schemas — they
 * describe what *consumers* are allowed to rely on. A route's internal
 * JSON-schema can change shape for validation purposes without this file
 * changing, but if the actual response body stops matching one of these
 * schemas, that's a breaking change for API consumers and the contract
 * test must fail.
 */

export const HealthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
  uptime: z.number(),
  version: z.string(),
});

export const AssetListResponseSchema = z.object({
  assets: z.array(z.unknown()),
  total: z.number().int(),
});

export const AnnotationSchema = z.object({
  id: z.string(),
  serviceName: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  content: z.string(),
  author: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ContractAnnotationListResponseSchema = z.array(AnnotationSchema);

export const ErrorResponseSchema = z.object({
  error: z.string(),
});
