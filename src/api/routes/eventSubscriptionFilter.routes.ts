import type { FastifyInstance } from "fastify";
import {
  eventSubscriptionFilterService,
  type FilterExpression,
  type PlatformEvent,
  type DeliveryChannel,
} from "../../services/eventSubscriptionFilter.service.js";

const subscriptionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    name: { type: "string" },
    filter: { type: "object", additionalProperties: true },
    deliveryChannels: { type: "array", items: { type: "string" } },
    deliveryDestination: { type: "string" },
    enabled: { type: "boolean" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
} as const;

export async function eventSubscriptionFilterRoutes(server: FastifyInstance) {
  server.post<{
    Params: { userId: string };
    Body: {
      name: string;
      filter: FilterExpression;
      deliveryChannels?: DeliveryChannel[];
      deliveryDestination?: string;
    };
  }>(
    "/:userId",
    {
      schema: {
        tags: ["Event Subscriptions"],
        summary: "Create an event subscription with filter rules",
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["name", "filter"],
          properties: {
            name: { type: "string", minLength: 1 },
            filter: { type: "object", additionalProperties: true },
            deliveryChannels: { type: "array", items: { type: "string" } },
            deliveryDestination: { type: "string" },
          },
        },
        response: {
          201: { type: "object", properties: { subscription: subscriptionSchema } },
          400: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const sub = await eventSubscriptionFilterService.create({
          userId: request.params.userId,
          ...request.body,
        });
        return reply.status(201).send({ subscription: sub });
      } catch {
        return reply.status(400).send({ error: "Invalid filter expression" });
      }
    },
  );

  server.get<{ Params: { userId: string } }>(
    "/:userId",
    {
      schema: {
        tags: ["Event Subscriptions"],
        summary: "List event subscriptions for a user",
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string" } },
        },
      },
    },
    async (request) => {
      const subscriptions = await eventSubscriptionFilterService.listByUser(request.params.userId);
      return { subscriptions };
    },
  );

  server.patch<{
    Params: { userId: string; id: string };
    Body: {
      name?: string;
      filter?: FilterExpression;
      deliveryChannels?: DeliveryChannel[];
      deliveryDestination?: string;
      enabled?: boolean;
    };
  }>(
    "/:userId/:id",
    {
      schema: {
        tags: ["Event Subscriptions"],
        summary: "Update an event subscription",
        params: {
          type: "object",
          required: ["userId", "id"],
          properties: { userId: { type: "string" }, id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      try {
        const updated = await eventSubscriptionFilterService.update(
          request.params.id,
          request.params.userId,
          request.body,
        );
        if (!updated) return reply.status(404).send({ error: "Subscription not found" });
        return { subscription: updated };
      } catch {
        return reply.status(400).send({ error: "Invalid filter expression" });
      }
    },
  );

  server.delete<{ Params: { userId: string; id: string } }>(
    "/:userId/:id",
    {
      schema: {
        tags: ["Event Subscriptions"],
        summary: "Delete an event subscription",
        params: {
          type: "object",
          required: ["userId", "id"],
          properties: { userId: { type: "string" }, id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const ok = await eventSubscriptionFilterService.delete(
        request.params.id,
        request.params.userId,
      );
      if (!ok) return reply.status(404).send({ error: "Subscription not found" });
      return { deleted: true };
    },
  );

  server.post<{
    Params: { userId: string };
    Body: { filter: FilterExpression; sampleEvents: PlatformEvent[]; limit?: number };
  }>(
    "/:userId/preview",
    {
      schema: {
        tags: ["Event Subscriptions"],
        summary: "Preview which sample events match a filter expression",
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["filter", "sampleEvents"],
          properties: {
            filter: { type: "object", additionalProperties: true },
            sampleEvents: { type: "array", items: { type: "object", additionalProperties: true } },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await eventSubscriptionFilterService.preview(
          request.params.userId,
          request.body.filter,
          request.body.sampleEvents,
          request.body.limit,
        );
        return result;
      } catch {
        return reply.status(400).send({ error: "Invalid filter expression" });
      }
    },
  );

  server.get<{ Params: { userId: string; id: string } }>(
    "/:userId/:id/audit",
    {
      schema: {
        tags: ["Event Subscriptions"],
        summary: "Get audit trail for a subscription",
        params: {
          type: "object",
          required: ["userId", "id"],
          properties: { userId: { type: "string" }, id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const sub = await eventSubscriptionFilterService.getById(
        request.params.id,
        request.params.userId,
      );
      if (!sub) return reply.status(404).send({ error: "Subscription not found" });
      const audit = await eventSubscriptionFilterService.getAuditTrail(request.params.id);
      return { audit };
    },
  );

  server.post<{ Body: PlatformEvent }>(
    "/dispatch",
    {
      schema: {
        tags: ["Event Subscriptions"],
        summary: "Dispatch event to matching subscriptions (internal)",
        body: {
          type: "object",
          required: ["eventType"],
          properties: {
            eventType: { type: "string" },
            asset: { type: "string" },
            severity: { type: "string", enum: ["info", "warning", "critical"] },
            source: { type: "string" },
            channel: { type: "string" },
            payload: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request) => {
      const matched = await eventSubscriptionFilterService.getMatchingSubscriptions(request.body);
      return { matched: matched.length, subscriptions: matched.map((s) => s.id) };
    },
  );
}
