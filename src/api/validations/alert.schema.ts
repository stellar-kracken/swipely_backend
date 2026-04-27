import { z } from "zod";

export const AlertConditionSchema = z.object({
  metric: z.string(),
  alertType: z.enum([
    "price_deviation",
    "supply_mismatch",
    "bridge_downtime",
    "health_score_drop",
    "volume_anomaly",
    "reserve_ratio_breach",
  ]),
  compareOp: z.enum(["gt", "lt", "eq"]),
  threshold: z.number(),
});

export const CreateAlertRuleSchema = z.object({
  name: z.string().min(1).max(100),
  assetCode: z.string().min(1),
  conditions: z.array(AlertConditionSchema).min(1),
  conditionOp: z.enum(["AND", "OR"]),
  priority: z.enum(["critical", "high", "medium", "low"]),
  cooldownSeconds: z.number().int().min(0),
  webhookUrl: z.string().url().optional(),
});

export const UpdateAlertRuleSchema = CreateAlertRuleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const BulkCreateAlertRulesSchema = z.object({
  rules: z.array(CreateAlertRuleSchema).min(1).max(50),
});

export const BulkUpdateAlertRulesSchema = z.object({
  updates: z.array(
    UpdateAlertRuleSchema.extend({
      id: z.string().uuid(),
    })
  ).min(1).max(50),
});

export const BulkDeleteAlertRulesSchema = z.object({
  ruleIds: z.array(z.string().uuid()).min(1).max(100),
});

export const AlertLifecycleActorSchema = z.string().min(1).max(120);

export const AlertLifecycleAcknowledgeSchema = z.object({
  ownerAddress: z.string().min(1),
  actor: AlertLifecycleActorSchema,
});

export const AlertLifecycleAssignSchema = z.object({
  ownerAddress: z.string().min(1),
  actor: AlertLifecycleActorSchema,
  assignee: z.string().min(1).max(120),
});

export const AlertLifecycleCloseSchema = z.object({
  ownerAddress: z.string().min(1),
  actor: AlertLifecycleActorSchema,
  note: z.string().max(500).optional(),
});

export const BulkAlertLifecycleSchema = z.object({
  ownerAddress: z.string().min(1),
  actor: AlertLifecycleActorSchema,
  eventIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(["acknowledge", "close"]),
  assignee: z.string().min(1).max(120).optional(),
  note: z.string().max(500).optional(),
}).superRefine((data, ctx) => {
  if (data.action === "acknowledge" && data.assignee) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assignee"],
      message: "assignee is not allowed for acknowledge action",
    });
  }
});

export const AlertHistoryQuerySchema = z.object({
  assetCode: z.string().optional(),
  alertType: z.string().optional(),
  priority: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const DryRunAlertSchema = z.object({
  rule: CreateAlertRuleSchema.omit({ webhookUrl: true }).partial(),
  metrics: z.record(z.string(), z.number()),
});
