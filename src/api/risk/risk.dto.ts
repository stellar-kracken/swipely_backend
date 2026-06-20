import { z } from "zod";

export const BridgeIdParamSchema = z.object({
  bridgeId: z.string()
});

export type BridgeIdParam = z.infer<typeof BridgeIdParamSchema>;
