import { z } from "zod";

export const OwnerTypeSchema = z.enum(["user", "team"]);

export const AssignOwnerSchema = z.object({
  ownerId: z.string().min(1).max(255),
  ownerType: OwnerTypeSchema,
  actorId: z.string().min(1).max(255),
});

export const AddEscalationContactSchema = z.object({
  contactUserId: z.string().min(1).max(255),
  order: z.number().int().min(1),
  actorId: z.string().min(1).max(255),
});

export const RemoveEscalationContactSchema = z.object({
  actorId: z.string().min(1).max(255),
});

export const OwnershipMatrixQuerySchema = z.object({
  teamId: z.string().optional(),
  ownerId: z.string().optional(),
  alertId: z.string().uuid().optional(),
  groupBy: z.enum(["team", "none"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const AuditHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const ExportOwnershipQuerySchema = z.object({
  format: z.enum(["csv", "json"]),
  teamId: z.string().optional(),
  ownerId: z.string().optional(),
  alertId: z.string().uuid().optional(),
});

export const SearchOwnershipQuerySchema = z.object({
  q: z.string().min(1),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
