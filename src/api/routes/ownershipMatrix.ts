import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { OwnershipMatrixService } from "../../services/ownershipMatrix.service.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  AssignOwnerSchema,
  AddEscalationContactSchema,
  RemoveEscalationContactSchema,
  OwnershipMatrixQuerySchema,
  AuditHistoryQuerySchema,
  ExportOwnershipQuerySchema,
  SearchOwnershipQuerySchema,
} from "../validations/ownershipMatrix.schema.js";

export async function ownershipMatrixRoutes(server: FastifyInstance) {
  const service = new OwnershipMatrixService();

  // All endpoints require authentication
  server.addHook("preHandler", authMiddleware());

  // ============================================================================
  // POST /alerts/:alertId/ownership — Assign or transfer ownership
  // ============================================================================
  server.post<{
    Params: { alertId: string };
    Body: { ownerId: string; ownerType: "user" | "team"; actorId: string };
  }>(
    "/alerts/:alertId/ownership",
    {
      schema: {
        tags: ["Ownership Matrix"],
        summary: "Assign or transfer alert ownership",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["alertId"],
          properties: {
            alertId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["ownerId", "ownerType", "actorId"],
          properties: {
            ownerId: { type: "string", minLength: 1, maxLength: 255 },
            ownerType: { type: "string", enum: ["user", "team"] },
            actorId: { type: "string", minLength: 1, maxLength: 255 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ownership: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  alertId: { type: "string" },
                  ownerType: { type: "string" },
                  ownerId: { type: "string" },
                  createdBy: { type: "string" },
                  createdAt: { type: "string" },
                },
              },
            },
          },
          400: { $ref: "Error#" },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const { alertId } = request.params;
        const data = AssignOwnerSchema.parse(request.body);

        const ownership = await service.assignOwner(
          alertId,
          data.ownerId,
          data.ownerType,
          data.actorId
        );

        return { ownership };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to assign ownership";
        const statusCode = message.includes("not found") ? 404 : 400;
        return reply.status(statusCode).send({ error: message });
      }
    }
  );

  // ============================================================================
  // GET /alerts/:alertId/ownership — Get current owner
  // ============================================================================
  server.get<{ Params: { alertId: string } }>(
    "/alerts/:alertId/ownership",
    {
      schema: {
        tags: ["Ownership Matrix"],
        summary: "Get current alert owner",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["alertId"],
          properties: {
            alertId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              ownership: {
                type: "object",
                nullable: true,
                properties: {
                  id: { type: "string" },
                  alertId: { type: "string" },
                  ownerType: { type: "string" },
                  ownerId: { type: "string" },
                  createdBy: { type: "string" },
                  createdAt: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { alertId } = request.params;
      const ownership = await service.getOwner(alertId);
      return { ownership };
    }
  );

  // ============================================================================
  // GET /ownership/matrix — Get ownership matrix
  // ============================================================================
  server.get<{ Querystring: any }>(
    "/ownership/matrix",
    {
      schema: {
        tags: ["Ownership Matrix"],
        summary: "Get ownership matrix with filters and pagination",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            teamId: { type: "string" },
            ownerId: { type: "string" },
            alertId: { type: "string", format: "uuid" },
            groupBy: { type: "string", enum: ["team", "none"] },
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    async (request) => {
      const query = OwnershipMatrixQuerySchema.parse(request.query);
      const { page = 1, limit = 50, groupBy, ...filters } = query;

      const result = await service.getOwnershipMatrix(
        { ...filters, groupBy },
        { page, limit }
      );

      return result;
    }
  );

  // ============================================================================
  // POST /alerts/:alertId/escalation — Add escalation contact
  // ============================================================================
  server.post<{
    Params: { alertId: string };
    Body: { contactUserId: string; order: number; actorId: string };
  }>(
    "/alerts/:alertId/escalation",
    {
      schema: {
        tags: ["Ownership Matrix"],
        summary: "Add escalation contact",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["alertId"],
          properties: {
            alertId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          required: ["contactUserId", "order", "actorId"],
          properties: {
            contactUserId: { type: "string", minLength: 1, maxLength: 255 },
            order: { type: "integer", minimum: 1 },
            actorId: { type: "string", minLength: 1, maxLength: 255 },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              contact: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  alertId: { type: "string" },
                  contactUserId: { type: "string" },
                  order: { type: "integer" },
                  createdBy: { type: "string" },
                  createdAt: { type: "string" },
                },
              },
            },
          },
          400: { $ref: "Error#" },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const { alertId } = request.params;
        const data = AddEscalationContactSchema.parse(request.body);

        const contact = await service.addEscalationContact(
          alertId,
          data.contactUserId,
          data.order,
          data.actorId
        );

        return reply.status(201).send({ contact });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to add escalation contact";
        const statusCode = message.includes("not found") ? 404 : 400;
        return reply.status(statusCode).send({ error: message });
      }
    }
  );

  // ============================================================================
  // GET /alerts/:alertId/escalation — Get escalation contacts
  // ============================================================================
  server.get<{ Params: { alertId: string } }>(
    "/alerts/:alertId/escalation",
    {
      schema: {
        tags: ["Ownership Matrix"],
        summary: "Get escalation contacts for an alert",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["alertId"],
          properties: {
            alertId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              contacts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    alertId: { type: "string" },
                    contactUserId: { type: "string" },
                    order: { type: "integer" },
                    createdBy: { type: "string" },
                    createdAt: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { alertId } = request.params;
      const contacts = await service.getEscalationContacts(alertId);
      return { contacts };
    }
  );

  // ============================================================================
  // DELETE /alerts/:alertId/escalation/:contactUserId — Remove escalation contact
  // ============================================================================
  server.delete<{
    Params: { alertId: string; contactUserId: string };
    Body: { actorId: string };
  }>(
    "/alerts/:alertId/escalation/:contactUserId",
    {
      schema: {
        tags: ["Ownership Matrix"],
        summary: "Remove escalation contact",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["alertId", "contactUserId"],
          properties: {
            alertId: { type: "string", format: "uuid" },
            contactUserId: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["actorId"],
          properties: {
            actorId: { type: "string", minLength: 1, maxLength: 255 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
            },
          },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const { alertId, contactUserId } = request.params;
      const data = RemoveEscalationContactSchema.parse(request.body);

      const removed = await service.removeEscalationContact(
        alertId,
        contactUserId,
        data.actorId
      );

      if (!removed) {
        return reply.status(404).send({ error: "Contact not found" });
      }

      return { success: true };
    }
  );

  // ============================================================================
  // GET /alerts/:alertId/ownership/history — Get audit history
  // ============================================================================
  server.get<{
    Params: { alertId: string };
    Querystring: { page?: number; limit?: number };
  }>(
    "/alerts/:alertId/ownership/history",
    {
      schema: {
        tags: ["Ownership Matrix"],
        summary: "Get ownership audit history for an alert",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["alertId"],
          properties: {
            alertId: { type: "string", format: "uuid" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              entries: { type: "array", items: { type: "object" } },
              meta: {
                type: "object",
                properties: {
                  total: { type: "integer" },
                  page: { type: "integer" },
                  limit: { type: "integer" },
                  totalPages: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const { alertId } = request.params;
      const query = AuditHistoryQuerySchema.parse(request.query);
      const { page = 1, limit = 50 } = query;

      const result = await service.getAuditHistory(alertId, { page, limit });
      return result;
    }
  );

  // ============================================================================
  // GET /ownership/export — Export ownership matrix
  // ============================================================================
  server.get<{ Querystring: any }>(
    "/ownership/export",
    {
      preHandler: authMiddleware({ requiredScopes: ["admin:ownership"] }),
      schema: {
        tags: ["Ownership Matrix"],
        summary: "Export ownership matrix (admin only)",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          required: ["format"],
          properties: {
            format: { type: "string", enum: ["csv", "json"] },
            teamId: { type: "string" },
            ownerId: { type: "string" },
            alertId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "string",
          },
          400: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const query = ExportOwnershipQuerySchema.parse(request.query);
        const { format, ...filters } = query;

        const data = await service.exportOwnershipMatrix(format, filters);

        const contentType = format === "csv" ? "text/csv" : "application/json";
        const filename = `ownership-matrix-${Date.now()}.${format}`;

        return reply
          .status(200)
          .header("Content-Type", contentType)
          .header("Content-Disposition", `attachment; filename="${filename}"`)
          .send(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to export ownership matrix";
        return reply.status(400).send({ error: message });
      }
    }
  );

  // ============================================================================
  // GET /ownership/search — Search ownership
  // ============================================================================
  server.get<{ Querystring: any }>(
    "/ownership/search",
    {
      schema: {
        tags: ["Ownership Matrix"],
        summary: "Search ownership by query string",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          required: ["q"],
          properties: {
            q: { type: "string", minLength: 1 },
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              data: { type: "array", items: { type: "object" } },
              meta: {
                type: "object",
                properties: {
                  total: { type: "integer" },
                  page: { type: "integer" },
                  limit: { type: "integer" },
                  totalPages: { type: "integer" },
                },
              },
            },
          },
          400: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const query = SearchOwnershipQuerySchema.parse(request.query);
        const { q, page = 1, limit = 50 } = query;

        const result = await service.searchOwnership(q, { page, limit });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to search ownership";
        return reply.status(400).send({ error: message });
      }
    }
  );
}
