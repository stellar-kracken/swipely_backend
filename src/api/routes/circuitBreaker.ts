import { FastifyInstance } from "fastify";
import { getCircuitBreakerService, PauseScope } from "../../services/circuitBreaker.service.js";
import { logger } from "../../utils/logger.js";

export async function circuitBreakerRoutes(fastify: FastifyInstance) {
  const circuitBreaker = getCircuitBreakerService();
  if (!circuitBreaker) {
    logger.warn("Circuit breaker service not configured, routes disabled");
    return;
  }

  // GET /api/v1/circuit-breaker/status
  fastify.get("/status", async (request, reply) => {
    try {
      const { scope, identifier } = request.query as {
        scope?: string;
        identifier?: string;
      };

      let pauseScope: PauseScope;
      switch (scope) {
        case "global":
          pauseScope = PauseScope.Global;
          break;
        case "bridge":
          if (!identifier) {
            return reply.code(400).send({ error: "identifier required for bridge scope" });
          }
          pauseScope = PauseScope.Bridge;
          break;
        case "asset":
          if (!identifier) {
            return reply.code(400).send({ error: "identifier required for asset scope" });
          }
          pauseScope = PauseScope.Asset;
          break;
        default:
          return reply.code(400).send({ error: "invalid scope" });
      }

      const isPaused = await circuitBreaker.isPaused(pauseScope, identifier);

      return {
        paused: isPaused,
        scope,
        identifier,
      };
    } catch (error) {
      logger.error({ err: error }, "Circuit breaker status check failed");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // GET /api/v1/circuit-breaker/whitelist
  fastify.get("/whitelist", async (request, reply) => {
    try {
      const { type, address, asset } = request.query as {
        type?: string;
        address?: string;
        asset?: string;
      };

      if (type === "address" && address) {
        const isWhitelisted = await circuitBreaker.isWhitelistedAddress(address);
        return { whitelisted: isWhitelisted, type: "address", address };
      }

      if (type === "asset" && asset) {
        const isWhitelisted = await circuitBreaker.isWhitelistedAsset(asset);
        return { whitelisted: isWhitelisted, type: "asset", asset };
      }

      return reply.code(400).send({ error: "invalid whitelist query" });
    } catch (error) {
      logger.error({ err: error }, "Whitelist check failed");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // POST /api/v1/circuit-breaker/pause
  fastify.post("/pause", async (request, reply) => {
    try {
      const { scope, identifier, reason } = request.body as {
        scope: string;
        identifier?: string;
        reason: string;
      };

      // TODO: Add authentication/authorization middleware
      // For now, this is a placeholder - in production, this would require
      // guardian authentication and proper key management

      logger.info({ scope, identifier, reason }, "Pause operation requested");
      return reply.code(501).send({ error: "Not implemented - requires guardian authentication" });
    } catch (error) {
      logger.error({ err: error }, "Pause operation failed");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  // POST /api/v1/circuit-breaker/recovery
  fastify.post("/recovery", async (request, reply) => {
    try {
      const { pauseId } = request.body as {
        pauseId: number;
      };

      // TODO: Add authentication/authorization middleware
      logger.info({ pauseId }, "Recovery operation requested");

      return reply.code(501).send({ error: "Not implemented - requires guardian authentication" });
    } catch (error) {
      logger.error({ err: error }, "Recovery operation failed");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });
}