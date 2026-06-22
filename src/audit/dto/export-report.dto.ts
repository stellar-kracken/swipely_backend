import { z } from "zod";

export const ExportReportSchema = z.object({
  format: z.enum(["CSV", "JSON", "PDF"]),
  from: z.string().optional(),
  to: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
});

export type ExportReportDto = z.infer<typeof ExportReportSchema>;
