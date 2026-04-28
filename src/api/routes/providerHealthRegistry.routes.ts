import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { providerHealthRegistryService } from "../../services/providerHealthRegistry.service.js";

const overrideSchema = z.object({
  enabled: z.boolean(),
  note: z.string().max(500).optional().nullable(),
});

export async function providerHealthRegistryRoutes(server: FastifyInstance) {
  server.get("/", async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await providerHealthRegistryService.listRegistry();
    } catch (error) {
      logger.error(error, "Failed to list provider health registry");
      reply.code(500);
      return { error: "Failed to list provider health registry" };
    }
  });

  server.patch(
    "/:providerKey/override",
    { preHandler: authMiddleware({ requiredScopes: ["jobs:trigger"] }) },
    async (
      request: FastifyRequest<{ Params: { providerKey: string }; Body: z.infer<typeof overrideSchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const body = overrideSchema.parse(request.body);
        const updated = await providerHealthRegistryService.setManualOverride(
          request.params.providerKey,
          body.enabled,
          body.note
        );

        if (!updated) {
          reply.code(404);
          return { error: "Provider not found" };
        }

        return { success: true };
      } catch (error) {
        logger.error(error, "Failed to update provider override");
        reply.code(500);
        return { success: false, error: "Failed to update provider override" };
      }
    }
  );
}
