import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { ExternalDependencyMonitorService } from "../../services/externalDependencyMonitor.service.js";
import { logger } from "../../utils/logger.js";

const monitorService = new ExternalDependencyMonitorService();

const listQuerySchema = z.object({
  includeHistory: z.coerce.boolean().optional().default(false),
  historyLimit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const maintenanceBodySchema = z.object({
  maintenanceMode: z.boolean(),
  note: z.string().max(500).optional().nullable(),
});

export async function externalDependenciesRoutes(server: FastifyInstance) {
  server.get(
    "/",
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof listQuerySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const query = listQuerySchema.parse(request.query);
        return await monitorService.listDependencies(query);
      } catch (error) {
        logger.error(error, "Failed to list external dependencies");
        reply.code(500);
        return { error: "Failed to list external dependencies" };
      }
    }
  );

  server.get(
    "/:providerKey/history",
    async (
      request: FastifyRequest<{
        Params: { providerKey: string };
        Querystring: z.infer<typeof historyQuerySchema>;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { limit } = historyQuerySchema.parse(request.query);
        const history = await monitorService.getDependencyHistory(
          request.params.providerKey,
          limit
        );
        return { providerKey: request.params.providerKey, history };
      } catch (error) {
        logger.error(error, "Failed to load dependency history");
        reply.code(500);
        return { error: "Failed to load dependency history" };
      }
    }
  );

  server.post(
    "/checks/run",
    {
      preHandler: authMiddleware({ requiredScopes: ["jobs:trigger"] }),
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const results = await monitorService.runAllChecks("manual");
        return { success: true, results };
      } catch (error) {
        logger.error(error, "Failed to run external dependency checks");
        reply.code(500);
        return { success: false, error: "Failed to run external dependency checks" };
      }
    }
  );

  server.patch(
    "/:providerKey/maintenance",
    {
      preHandler: authMiddleware({ requiredScopes: ["jobs:trigger"] }),
    },
    async (
      request: FastifyRequest<{
        Params: { providerKey: string };
        Body: z.infer<typeof maintenanceBodySchema>;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const body = maintenanceBodySchema.parse(request.body);
        const dependency = await monitorService.setMaintenanceMode(
          request.params.providerKey,
          body.maintenanceMode,
          body.note
        );

        if (!dependency) {
          reply.code(404);
          return { error: "Dependency not found" };
        }

        return { success: true, dependency };
      } catch (error) {
        logger.error(error, "Failed to update dependency maintenance mode");
        reply.code(500);
        return { success: false, error: "Failed to update dependency maintenance mode" };
      }
    }
  );
}
