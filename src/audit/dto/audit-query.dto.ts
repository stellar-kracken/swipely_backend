import { z } from "zod";

export const AuditQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
});

export type AuditQueryDto = z.infer<typeof AuditQuerySchema>;
