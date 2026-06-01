import { FastifyInstance } from "fastify";
import { getCircuitHealthService } from "../../services/circuitHealth.service.js";
import { logger } from "../../utils/logger.js";

/**
 * Circuit Health API Routes
 *
 * Provides comprehensive health information for alerting and protection circuits,
 * including:
 * - Circuit states (global, bridge-level, asset-level)
 * - Recent transitions with timestamps
 * - Manual overrides (whitelisted items)
 * - Historical data with configurable limits
 * - Efficient caching for performance
 *
 * Example payloads documented at the end of this file.
 */
export async function circuitHealthRoutes(fastify: FastifyInstance) {
  const healthService = getCircuitHealthService();

  /**
   * GET /health
   * Get comprehensive circuit health information for all scopes
   *
   * Query Parameters:
   *   - includeHistory: boolean (optional) - Include transition history
   *   - historyLimit: number (optional) - Limit for transitions (default: 100)
   *
   * Response: CircuitHealthInfo with all circuit states, transitions, and overrides
   */
  fastify.get(
    "/health",
    {
      schema: {
        tags: ["Circuit Health"],
        summary: "Get comprehensive circuit health information",
        description:
          "Returns complete health status for all circuits (global, bridges, assets), recent transitions, and manual overrides with caching.",
        querystring: {
          type: "object",
          properties: {
            includeHistory: {
              type: "boolean",
              description: "Include full transition history (bypasses cache)",
            },
            historyLimit: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
              description: "Maximum number of transitions to return (default: 100)",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              timestamp: { type: "number", description: "Unix timestamp of health check" },
              global: { $ref: "CircuitState#" },
              bridges: {
                type: "object",
                additionalProperties: { $ref: "CircuitState#" },
              },
              assets: {
                type: "object",
                additionalProperties: { $ref: "CircuitState#" },
              },
              recentTransitions: {
                type: "array",
                items: { $ref: "CircuitTransition#" },
              },
              manualOverrides: {
                type: "array",
                items: { $ref: "ManualOverride#" },
              },
              cacheExpiresAt: { type: "number", description: "When cache expires" },
            },
          },
          500: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const { includeHistory, historyLimit } = request.query as {
          includeHistory?: boolean;
          historyLimit?: number;
        };

        const health = await healthService.getCircuitHealth({
          includeHistory,
          historyLimit,
        });

        // Convert Maps to objects for JSON serialization
        if (health && typeof health === "object" && "bridges" in health) {
          const healthInfo = health as any;
          return {
            ...healthInfo,
            bridges: Object.fromEntries(healthInfo.bridges || []),
            assets: Object.fromEntries(healthInfo.assets || []),
          };
        }

        return health;
      } catch (error) {
        logger.error({ error }, "Circuit health check failed");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  /**
   * GET /health/state
   * Get circuit state for a specific scope
   *
   * Query Parameters:
   *   - scope: 'global' | 'bridge' | 'asset' (required)
   *   - identifier: string (required for bridge/asset scope)
   *
   * Response: CircuitState for the specified scope
   */
  fastify.get(
    "/health/state",
    {
      schema: {
        tags: ["Circuit Health"],
        summary: "Get circuit state for a specific scope",
        description:
          "Returns the current state (paused/active, level, details) for a specific circuit scope.",
        querystring: {
          type: "object",
          required: ["scope"],
          properties: {
            scope: {
              type: "string",
              enum: ["global", "bridge", "asset"],
              description: "Circuit scope to query",
            },
            identifier: {
              type: "string",
              description: "Required for bridge and asset scopes",
            },
          },
        },
        response: {
          200: { $ref: "CircuitState#" },
          400: { $ref: "Error#" },
          500: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const { scope, identifier } = request.query as {
          scope?: string;
          identifier?: string;
        };

        if (!scope || !["global", "bridge", "asset"].includes(scope)) {
          return reply.code(400).send({ error: "Invalid or missing scope" });
        }

        if ((scope === "bridge" || scope === "asset") && !identifier) {
          return reply.code(400).send({ error: `identifier required for ${scope} scope` });
        }

        const state = await healthService.getCircuitHealth({
          scope: scope as "global" | "bridge" | "asset",
          identifier,
        });

        return state;
      } catch (error) {
        logger.error({ error }, "Failed to get circuit state");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  /**
   * GET /health/transitions
   * Get recent circuit transitions with optional filtering
   *
   * Query Parameters:
   *   - limit: number (default: 50, max: 500)
   *   - scope: 'global' | 'bridge' | 'asset' (optional)
   *   - identifier: string (optional, requires scope)
   *
   * Response: Array of CircuitTransition objects
   */
  fastify.get(
    "/health/transitions",
    {
      schema: {
        tags: ["Circuit Health"],
        summary: "Get recent circuit transitions",
        description:
          "Returns a list of recent circuit state transitions (pauses, recoveries, etc.) with optional filtering.",
        querystring: {
          type: "object",
          properties: {
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 500,
              default: 50,
              description: "Maximum number of transitions to return",
            },
            scope: {
              type: "string",
              enum: ["global", "bridge", "asset"],
              description: "Filter by circuit scope",
            },
            identifier: {
              type: "string",
              description: "Filter by identifier (requires scope)",
            },
          },
        },
        response: {
          200: {
            type: "array",
            items: { $ref: "CircuitTransition#" },
          },
          400: { $ref: "Error#" },
          500: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const { limit, scope, identifier } = request.query as {
          limit?: number;
          scope?: string;
          identifier?: string;
        };

        if (scope && !["global", "bridge", "asset"].includes(scope)) {
          return reply.code(400).send({ error: "Invalid scope" });
        }

        const transitions = await healthService.getRecentTransitions(
          limit || 50,
          scope as "global" | "bridge" | "asset" | undefined,
          identifier
        );

        return transitions;
      } catch (error) {
        logger.error({ error }, "Failed to get transitions");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  /**
   * GET /health/overrides
   * Get manual overrides (whitelisted items)
   *
   * Query Parameters:
   *   - type: 'address' | 'asset' | 'bridge' (optional)
   *
   * Response: Array of ManualOverride objects
   */
  fastify.get(
    "/health/overrides",
    {
      schema: {
        tags: ["Circuit Health"],
        summary: "Get manual overrides (whitelisted items)",
        description:
          "Returns all whitelisted items that bypass circuit breaker protections.",
        querystring: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["address", "asset", "bridge"],
              description: "Filter by override type",
            },
          },
        },
        response: {
          200: {
            type: "array",
            items: { $ref: "ManualOverride#" },
          },
          400: { $ref: "Error#" },
          500: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const { type } = request.query as {
          type?: "address" | "asset" | "bridge";
        };

        if (type && !["address", "asset", "bridge"].includes(type)) {
          return reply.code(400).send({ error: "Invalid type" });
        }

        const overrides = await healthService.getWhitelistByType(type || "address");
        return overrides;
      } catch (error) {
        logger.error({ error }, "Failed to get overrides");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  /**
   * GET /health/cache/stats
   * Get cache performance statistics
   *
   * Response: Cache statistics including hit rate and size
   */
  fastify.get(
    "/health/cache/stats",
    {
      schema: {
        tags: ["Circuit Health"],
        summary: "Get cache statistics",
        description: "Returns cache performance metrics for circuit health data.",
        response: {
          200: {
            type: "object",
            properties: {
              hitRate: { type: "number", description: "Cache hit rate (0-1)" },
              missCount: { type: "integer", description: "Number of cache misses" },
              size: { type: "integer", description: "Number of cached items" },
              ttl: { type: "integer", description: "Cache TTL in seconds" },
            },
          },
          500: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        const stats = await healthService.getCacheStats();
        return stats;
      } catch (error) {
        logger.error({ error }, "Failed to get cache stats");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────────
  // Schema Definitions (added to fastify.datastore for OpenAPI)
  // ──────────────────────────────────────────────────────────────────────────────

  fastify.addSchema({
    $id: "CircuitState#",
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["global", "bridge", "asset"],
        description: "Circuit scope",
      },
      identifier: {
        type: ["string", "null"],
        description: "Bridge ID or asset code (null for global)",
      },
      level: {
        type: "string",
        enum: ["none", "warning", "partial", "full"],
        description: "Pause level indicating severity",
      },
      isPaused: {
        type: "boolean",
        description: "Whether circuit is currently paused",
      },
      triggeredBy: {
        type: ["string", "null"],
        description: "Address that triggered the pause",
      },
      triggerReason: {
        type: ["string", "null"],
        description: "Reason for the pause",
      },
      timestamp: {
        type: ["integer", "null"],
        description: "Unix timestamp of pause trigger",
      },
      recoveryDeadline: {
        type: ["integer", "null"],
        description: "Unix timestamp of recovery deadline",
      },
      guardianApprovals: {
        type: ["integer", "null"],
        description: "Number of guardian approvals for recovery",
      },
      guardianThreshold: {
        type: ["integer", "null"],
        description: "Required threshold of guardian approvals",
      },
      status: {
        type: ["string", "null"],
        enum: ["active", "recovering", "resolved", null],
        description: "Current pause status",
      },
    },
  });

  fastify.addSchema({
    $id: "CircuitTransition#",
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Unique transition identifier",
      },
      pauseId: {
        type: "integer",
        description: "Pause event ID",
      },
      scope: {
        type: "string",
        enum: ["global", "bridge", "asset"],
      },
      identifier: {
        type: ["string", "null"],
      },
      level: {
        type: "string",
        enum: ["none", "warning", "partial", "full"],
      },
      triggeredBy: {
        type: "string",
      },
      reason: {
        type: "string",
      },
      timestamp: {
        type: "integer",
      },
      recoveryDeadline: {
        type: "integer",
      },
      status: {
        type: "string",
        enum: ["active", "recovering", "resolved"],
      },
    },
  });

  fastify.addSchema({
    $id: "ManualOverride#",
    type: "object",
    properties: {
      id: {
        type: "integer",
        description: "Override ID",
      },
      type: {
        type: "string",
        enum: ["address", "asset", "bridge"],
        description: "Type of override",
      },
      value: {
        type: "string",
        description: "Address, asset code, or bridge ID",
      },
      addedBy: {
        type: "string",
        description: "Address that added the override",
      },
      addedAt: {
        type: "string",
        format: "date-time",
        description: "When the override was added",
      },
    },
  });
}
