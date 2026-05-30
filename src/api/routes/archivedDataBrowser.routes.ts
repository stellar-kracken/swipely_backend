import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import {
  ArchivedDataBrowserService,
  type RawArchiveBrowserQuery,
} from "../../services/archivedDataBrowser.service.js";
import { logger } from "../../utils/logger.js";

const service = new ArchivedDataBrowserService();
const requireArchiveRead = authMiddleware({ requiredScopes: ["archive:read"] });

export async function archivedDataBrowserRoutes(server: FastifyInstance) {
  // GET /entities — list browsable archive entity types (read-only)
  server.get(
    "/entities",
    { preHandler: requireArchiveRead },
    async (_request, reply: FastifyReply) => {
      try {
        return { success: true, data: service.listEntities() };
      } catch (error) {
        logger.error(error, "Failed to list archive entities");
        reply.code(500);
        return { success: false, error: "Failed to list archive entities" };
      }
    },
  );

  // GET / — paginated archive search with date and asset filters
  server.get(
    "/",
    { preHandler: requireArchiveRead },
    async (
      request: FastifyRequest<{ Querystring: RawArchiveBrowserQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        const data = await service.search(request.query);
        return { success: true, data };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to search archived data";
        logger.warn({ err: error }, "archive browser search failed");
        reply.code(400);
        return { success: false, error: message };
      }
    },
  );

  // GET /:entityType/:id — fetch one archived snapshot row by archive id
  server.get(
    "/:entityType/:id",
    { preHandler: requireArchiveRead },
    async (
      request: FastifyRequest<{ Params: { entityType: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const row = await service.getSnapshot(
          request.params.entityType,
          request.params.id,
        );
        if (!row) {
          reply.code(404);
          return { success: false, error: "Archived snapshot not found" };
        }
        return { success: true, data: row };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to fetch archived snapshot";
        logger.warn({ err: error }, "archive browser snapshot fetch failed");
        reply.code(400);
        return { success: false, error: message };
      }
    },
  );
}
