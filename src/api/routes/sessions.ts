import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { SessionService, type SessionStatus } from "../../services/session.service.js";
import { authMiddleware } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import { logger } from "../../utils/logger.js";
import { PaginationSchema } from "../validations/common.schema.js";

const sessionService = new SessionService();

const CreateSessionSchema = z.object({
  userId: z.string().min(1).max(255),
  deviceId: z.string().max(128).optional(),
  deviceName: z.string().max(255).optional(),
  deviceType: z.enum(["web", "mobile", "desktop", "api", "other"]).optional(),
  userAgent: z.string().max(512).optional(),
  ttlSeconds: z.number().int().min(60).max(60 * 60 * 24 * 365).optional(),
});

const RevokeSessionSchema = z.object({
  reason: z.string().max(255).optional(),
});

const SessionListQuerySchema = PaginationSchema.extend({
  userId: z.string().optional(),
  status: z.enum(["active", "expired", "revoked"]).optional(),
});

export async function sessionsRoutes(server: FastifyInstance) {
  server.post(
    "/",
    {
      preHandler: [
        authMiddleware({ requiredScopes: ["sessions:write"] }),
        validateRequest({ body: CreateSessionSchema }),
      ],
    },
    async (
      request: FastifyRequest<{ Body: z.infer<typeof CreateSessionSchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const { session, token } = await sessionService.createSession({
          ...(request.body as any),
          ipAddress: request.ip,
          userAgent: request.body.userAgent ?? request.headers["user-agent"],
        });
        reply.code(201);
        return { success: true, data: { session, token } };
      } catch (error) {
        logger.error(error, "Failed to create session");
        reply.code(500);
        return { success: false, error: "Failed to create session" };
      }
    }
  );

  server.get(
    "/",
    {
      preHandler: [
        authMiddleware({ requiredScopes: ["sessions:read"] }),
        validateRequest({ query: SessionListQuerySchema }),
      ],
    },
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof SessionListQuerySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const { userId, status, page, limit } = request.query;
        const result = await sessionService.listSessions({
          userId,
          status: status as SessionStatus | undefined,
          page,
          limit,
        });

        reply.header("X-Total-Count", String(result.meta.total));
        reply.header("X-Total-Pages", String(result.meta.totalPages));
        reply.header("X-Current-Page", String(result.meta.page));

        return { success: true, data: result.data, meta: result.meta };
      } catch (error) {
        logger.error(error, "Failed to list sessions");
        reply.code(500);
        return { success: false, error: "Failed to list sessions" };
      }
    }
  );

  server.get(
    "/:id",
    {
      preHandler: authMiddleware({ requiredScopes: ["sessions:read"] }),
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const session = await sessionService.getSessionById(request.params.id);
        if (!session) {
          reply.code(404);
          return { success: false, error: "Session not found" };
        }
        return { success: true, data: session };
      } catch (error) {
        logger.error(error, "Failed to get session");
        reply.code(500);
        return { success: false, error: "Failed to get session" };
      }
    }
  );

  server.post(
    "/validate",
    async (
      request: FastifyRequest<{ Body: { token: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const { token } = request.body ?? {};
        if (!token) {
          reply.code(400);
          return { success: false, error: "token is required" };
        }
        const session = await sessionService.validateSession(token);
        if (!session) {
          reply.code(401);
          return { success: false, error: "Invalid or expired session" };
        }
        return { success: true, data: session };
      } catch (error) {
        logger.error(error, "Session validation failed");
        reply.code(500);
        return { success: false, error: "Session validation failed" };
      }
    }
  );

  server.delete(
    "/:id",
    {
      preHandler: [
        authMiddleware({ requiredScopes: ["sessions:write"] }),
        validateRequest({ body: RevokeSessionSchema }),
      ],
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: z.infer<typeof RevokeSessionSchema>;
      }>,
      reply: FastifyReply
    ) => {
      try {
        const actor = request.apiKeyAuth?.id ?? "unknown";
        const revoked = await sessionService.revokeSession(
          request.params.id,
          actor,
          request.body?.reason,
          request.ip
        );
        if (!revoked) {
          reply.code(404);
          return { success: false, error: "Session not found or already revoked" };
        }
        return { success: true, message: "Session revoked" };
      } catch (error) {
        logger.error(error, "Failed to revoke session");
        reply.code(500);
        return { success: false, error: "Failed to revoke session" };
      }
    }
  );

  server.delete(
    "/users/:userId/all",
    {
      preHandler: authMiddleware({ requiredScopes: ["sessions:write"] }),
    },
    async (
      request: FastifyRequest<{
        Params: { userId: string };
        Querystring: { exceptSessionId?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const actor = request.apiKeyAuth?.id ?? "unknown";
        const count = await sessionService.revokeAllUserSessions(
          request.params.userId,
          actor,
          request.query.exceptSessionId,
          request.ip
        );
        return { success: true, data: { revokedCount: count } };
      } catch (error) {
        logger.error(error, "Failed to revoke all user sessions");
        reply.code(500);
        return { success: false, error: "Failed to revoke sessions" };
      }
    }
  );

  server.get(
    "/:id/audit",
    {
      preHandler: authMiddleware({ requiredScopes: ["sessions:read"] }),
    },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const log = await sessionService.getAuditLog(request.params.id);
        return { success: true, data: log };
      } catch (error) {
        logger.error(error, "Failed to get session audit log");
        reply.code(500);
        return { success: false, error: "Failed to get audit log" };
      }
    }
  );

  server.post(
    "/purge-expired",
    {
      preHandler: authMiddleware({ requiredScopes: ["jobs:trigger"] }),
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const count = await sessionService.purgeExpiredSessions();
        return { success: true, data: { purgedCount: count } };
      } catch (error) {
        logger.error(error, "Failed to purge expired sessions");
        reply.code(500);
        return { success: false, error: "Failed to purge expired sessions" };
      }
    }
  );
}
