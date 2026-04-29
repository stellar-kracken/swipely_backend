import { z } from "zod";

const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const channelSchema = z.enum(["in_app", "webhook", "email"]);

export const createAlertRoutingRuleSchema = z.object({
  name: z.string().min(1).max(120),
  ownerAddress: z.string().min(1).optional().nullable(),
  severityLevels: z.array(severitySchema).min(1).optional(),
  assetCodes: z.array(z.string().min(1)).max(250).optional(),
  sourceTypes: z.array(z.string().min(1)).max(250).optional(),
  channels: z.array(channelSchema).min(1),
  fallbackChannels: z.array(channelSchema).optional(),
  suppressionWindowSeconds: z.number().int().min(0).max(86400).optional(),
  priorityOrder: z.number().int().min(1).max(10000).optional(),
  isActive: z.boolean().optional(),
});

export const updateAlertRoutingRuleSchema = createAlertRoutingRuleSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const listAlertRoutingRulesQuerySchema = z.object({
  ownerAddress: z.string().min(1).optional(),
});

export const listAlertRoutingAuditQuerySchema = z.object({
  ownerAddress: z.string().min(1).optional(),
  status: z.enum(["queued", "delivered", "suppressed", "failed", "fallback"]).optional(),
  channel: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
