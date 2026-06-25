import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.js";
import { providerCircuitBreakerService } from "../../services/providerCircuitBreaker.service.js";

const overrideBodySchema = z.object({
  override: z.enum(["force_open", "force_closed"]).nullable(),
});

const fallbackBodySchema = z.object({
  fallbackProviderKey: z.string().trim().min(1).max(120).nullable(),
});

const thresholdsBodySchema = z.object({
  failureThreshold: z.number().int().positive().optional(),
  recoveryTimeoutMs: z.number().int().positive().optional(),
});

export async function providerCircuitBreakerRoutes(server: FastifyInstance) {
  const requireOps = authMiddleware({ requiredScopes: ["admin:config"] });

  server.get(
    "/",
    {
      schema: {
        tags: ["Provider Circuit Breaker"],
        summary: "List circuit breaker state for all tracked providers",
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (_request, reply) => {
      const breakers = await providerCircuitBreakerService.listStates();
      return reply.send({ breakers, count: breakers.length });
    }
  );

  server.get<{ Params: { providerKey: string } }>(
    "/:providerKey",
    {
      schema: {
        tags: ["Provider Circuit Breaker"],
        summary: "Get circuit breaker state for a provider",
        params: { type: "object", required: ["providerKey"], properties: { providerKey: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const breaker = await providerCircuitBreakerService.getState(request.params.providerKey);
      return reply.send({ breaker });
    }
  );

  server.get<{ Params: { providerKey: string }; Querystring: { limit?: string } }>(
    "/:providerKey/history",
    {
      schema: {
        tags: ["Provider Circuit Breaker"],
        summary: "Get state transition history for a provider's circuit breaker",
        params: { type: "object", required: ["providerKey"], properties: { providerKey: { type: "string" } } },
        querystring: { type: "object", properties: { limit: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const history = await providerCircuitBreakerService.getTransitionHistory(
        request.params.providerKey,
        request.query.limit ? Number(request.query.limit) : undefined
      );
      return reply.send({ history });
    }
  );

  server.get<{ Params: { providerKey: string } }>(
    "/:providerKey/fallback",
    {
      schema: {
        tags: ["Provider Circuit Breaker"],
        summary: "Resolve the fallback provider to use if this provider's breaker is open",
        params: { type: "object", required: ["providerKey"], properties: { providerKey: { type: "string" } } },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const [available, fallbackProviderKey] = await Promise.all([
        providerCircuitBreakerService.isAvailable(request.params.providerKey),
        providerCircuitBreakerService.getFallbackProvider(request.params.providerKey),
      ]);
      return reply.send({ providerKey: request.params.providerKey, available, fallbackProviderKey });
    }
  );

  server.put<{ Params: { providerKey: string }; Body: { fallbackProviderKey: string | null } }>(
    "/:providerKey/fallback",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Provider Circuit Breaker"],
        summary: "Configure the fallback provider used when this provider's breaker is open",
        params: { type: "object", required: ["providerKey"], properties: { providerKey: { type: "string" } } },
        body: { type: "object", required: ["fallbackProviderKey"], properties: { fallbackProviderKey: { type: "string", nullable: true } } },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const body = fallbackBodySchema.parse(request.body);
      const breaker = await providerCircuitBreakerService.setFallback(
        request.params.providerKey,
        body.fallbackProviderKey,
        request.apiKeyAuth?.id ?? request.apiKeyAuth?.name ?? "admin"
      );
      return reply.send({ breaker });
    }
  );

  server.put<{ Params: { providerKey: string }; Body: { override: "force_open" | "force_closed" | null } }>(
    "/:providerKey/override",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Provider Circuit Breaker"],
        summary: "Manually force a provider's circuit breaker open or closed (null clears the override)",
        params: { type: "object", required: ["providerKey"], properties: { providerKey: { type: "string" } } },
        body: { type: "object", required: ["override"], properties: { override: { type: "string", nullable: true } } },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const body = overrideBodySchema.parse(request.body);
      const breaker = await providerCircuitBreakerService.setManualOverride(
        request.params.providerKey,
        body.override,
        request.apiKeyAuth?.id ?? request.apiKeyAuth?.name ?? "admin"
      );
      return reply.send({ breaker });
    }
  );

  server.put<{ Params: { providerKey: string }; Body: { failureThreshold?: number; recoveryTimeoutMs?: number } }>(
    "/:providerKey/thresholds",
    {
      preHandler: requireOps,
      schema: {
        tags: ["Provider Circuit Breaker"],
        summary: "Configure failure threshold and recovery timeout for a provider",
        params: { type: "object", required: ["providerKey"], properties: { providerKey: { type: "string" } } },
        body: {
          type: "object",
          properties: { failureThreshold: { type: "integer" }, recoveryTimeoutMs: { type: "integer" } },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const body = thresholdsBodySchema.parse(request.body);
      const breaker = await providerCircuitBreakerService.configureThresholds(request.params.providerKey, body);
      return reply.send({ breaker });
    }
  );
}
