import { FastifyInstance } from "fastify";
import { auditController } from "./audit.controller.js";
import { AuditMiddleware } from "./audit.middleware.js";

export async function auditModule(fastify: FastifyInstance) {
  // Register routes
  fastify.register(auditController, { prefix: "/api/audit" });
  
  // Expose middleware
  fastify.decorate("auditMiddleware", AuditMiddleware);
}
