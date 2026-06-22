import { FastifyRequest, FastifyReply } from "fastify";
import { auditService } from "./audit.service.js";

export const AuditMiddleware = async (request: FastifyRequest, reply: FastifyReply) => {
  // Try to capture actor from request (e.g. from JWT token)
  const actorId = (request as any).user?.id || "anonymous";
  const actorType = (request as any).user?.role === "admin" ? "admin" : "user";
  
  // This will run after the request is processed to get the final status
  reply.raw.on('finish', async () => {
    // Basic automatic logging for important routes
    if (request.method !== "GET" && request.method !== "OPTIONS") {
      try {
        await auditService.log({
          actorId,
          actorType,
          action: "SYSTEM_OVERRIDE", // Default action, in reality would map route to action
          resourceType: "api_route",
          resourceId: request.url,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || "Unknown",
          metadata: {
            method: request.method,
            statusCode: reply.statusCode,
            requestId: request.id,
          }
        });
      } catch (err) {
        console.error("Failed to log audit event in middleware", err);
      }
    }
  });
};
