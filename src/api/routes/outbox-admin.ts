import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDatabase } from "../../database/connection.js";
import { OutboxAdminApi } from "../../outbox/adminApi.js";
import { logger } from "../../utils/logger.js";

// Validation schemas
const RetryEventSchema = z.object({
  eventId: z.string().uuid(),
});

const RetryEventsSchema = z.object({
  eventIds: z.array(z.string().uuid()).min(1).max(100),
});

const PaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(1000).default(100),
  offset: z.coerce.number().min(0).default(0),
  eventType: z.string().optional(),
});

const PurgeSchema = z.object({
  olderThanDays: z.coerce.number().min(1).max(365).default(30),
});

export async function outboxAdminRoutes(fastify: FastifyInstance) {
  const db = getDatabase();
  const adminApi = new OutboxAdminApi(db);

  // Add authentication middleware for admin routes
  fastify.addHook("preHandler", async (request, reply) => {
    // TODO: Implement proper admin authentication
    // For now, this is a placeholder - in production you'd check API keys, JWT tokens, etc.
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    
    // Simple token validation (replace with proper auth)
    const token = authHeader.substring(7);
    if (token !== process.env.ADMIN_API_TOKEN) {
      return reply.code(401).send({ error: "Invalid token" });
    }
  });

  // GET /admin/outbox/stats - Get comprehensive outbox statistics
  fastify.get("/stats", {
    schema: {
      description: "Get outbox statistics including pending, failed, and dead letter counts",
      tags: ["outbox-admin"],
      response: {
        200: {
          type: "object",
          properties: {
            outbox: {
              type: "object",
              properties: {
                pending: { type: "number" },
                processing: { type: "number" },
                delivered: { type: "number" },
                failed: { type: "number" },
                totalEvents: { type: "number" },
              },
            },
            deadLetter: {
              type: "object",
              properties: {
                total: { type: "number" },
                byEventType: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      eventType: { type: "string" },
                      count: { type: "number" },
                    },
                  },
                },
                byError: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      error: { type: "string" },
                      count: { type: "number" },
                    },
                  },
                },
              },
            },
            dispatcher: {
              type: "object",
              properties: {
                queueWaiting: { type: "number" },
                queueActive: { type: "number" },
                isRunning: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const stats = await adminApi.getStats();
      return reply.send(stats);
    } catch (error) {
      logger.error({ error }, "Failed to get outbox stats");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // GET /admin/outbox/pending - Get pending events with pagination
  fastify.get("/pending", {
    schema: {
      description: "Get pending outbox events with pagination",
      tags: ["outbox-admin"],
      querystring: {
        type: "object",
        properties: {
          limit: { type: "number", minimum: 1, maximum: 1000, default: 100 },
          offset: { type: "number", minimum: 0, default: 0 },
          eventType: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { limit, offset, eventType } = PaginationSchema.parse(request.query);
      const result = await adminApi.getPendingEvents(limit, offset, eventType);
      return reply.send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: "Invalid query parameters", details: error.errors });
      }
      logger.error({ error }, "Failed to get pending events");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // POST /admin/outbox/retry/:eventId - Retry a single failed event
  fastify.post("/retry/:eventId", {
    schema: {
      description: "Retry a single failed outbox event",
      tags: ["outbox-admin"],
      params: {
        type: "object",
        properties: {
          eventId: { type: "string", format: "uuid" },
        },
        required: ["eventId"],
      },
    },
  }, async (request, reply) => {
    try {
      const { eventId } = RetryEventSchema.parse(request.params);
      const result = await adminApi.retryEvent(eventId);
      
      if (result.success) {
        return reply.send(result);
      } else {
        return reply.code(400).send(result);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: "Invalid event ID", details: error.errors });
      }
      logger.error({ error }, "Failed to retry event");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // POST /admin/outbox/retry-batch - Retry multiple failed events
  fastify.post("/retry-batch", {
    schema: {
      description: "Retry multiple failed outbox events",
      tags: ["outbox-admin"],
      body: {
        type: "object",
        properties: {
          eventIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            minItems: 1,
            maxItems: 100,
          },
        },
        required: ["eventIds"],
      },
    },
  }, async (request, reply) => {
    try {
      const { eventIds } = RetryEventsSchema.parse(request.body);
      const result = await adminApi.retryEvents(eventIds);
      return reply.send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: "Invalid request body", details: error.errors });
      }
      logger.error({ error }, "Failed to retry events");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // GET /admin/outbox/health - Health check endpoint
  fastify.get("/health", {
    schema: {
      description: "Health check for outbox system",
      tags: ["outbox-admin"],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            pending: { type: "number" },
            processing: { type: "number" },
            failed: { type: "number" },
            deadLetter: { type: "number" },
            timestamp: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const stats = await adminApi.getStats();
      
      // Determine health status based on metrics
      let status = "healthy";
      if (stats.outbox.failed > 100) {
        status = "degraded";
      }
      if (stats.deadLetter.total > 50) {
        status = "unhealthy";
      }

      return reply.send({
        status,
        pending: stats.outbox.pending,
        processing: stats.outbox.processing,
        failed: stats.outbox.failed,
        deadLetter: stats.deadLetter.total,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, "Health check failed");
      return reply.code(500).send({
        status: "error",
        error: "Health check failed",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // POST /admin/outbox/purge/delivered - Purge old delivered events
  fastify.post("/purge/delivered", {
    schema: {
      description: "Purge old delivered events for cleanup",
      tags: ["outbox-admin"],
      body: {
        type: "object",
        properties: {
          olderThanDays: { type: "number", minimum: 1, maximum: 365, default: 30 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { olderThanDays } = PurgeSchema.parse(request.body || {});
      const result = await adminApi.purgeDeliveredEvents(olderThanDays);
      return reply.send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ error: "Invalid request body", details: error.errors });
      }
      logger.error({ error }, "Failed to purge delivered events");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // GET /admin/outbox/events/:eventId - Get specific event details
  fastify.get("/events/:eventId", {
    schema: {
      description: "Get details of a specific outbox event",
      tags: ["outbox-admin"],
      params: {
        type: "object",
        properties: {
          eventId: { type: "string" },
        },
        required: ["eventId"],
      },
    },
  }, async (request, reply) => {
    try {
      const { eventId } = request.params as { eventId: string };
      
      const [event] = await db("outbox_events")
        .select("*")
        .where({ id: eventId });

      if (!event) {
        return reply.code(404).send({ error: "Event not found" });
      }

      // Map to response format
      const eventRecord = {
        id: event.id.toString(),
        aggregateType: event.aggregate_type,
        aggregateId: event.aggregate_id,
        sequenceNo: event.sequence_no.toString(),
        eventType: event.event_type,
        payload: typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload,
        metadata: typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata,
        status: event.status,
        retryCount: event.retry_count,
        retryAfter: event.retry_after,
        deliveredAt: event.delivered_at,
        errorMessage: event.error_message,
        createdAt: event.created_at,
      };

      return reply.send(eventRecord);
    } catch (error) {
      logger.error({ error, eventId: request.params }, "Failed to get event details");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });
}