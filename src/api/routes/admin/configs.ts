import type { FastifyInstance } from "fastify";
import { getDatabase } from "../../../database/connection.js";
import { createRedisClient } from "../../../config/redis.js";
import { ConfigService } from "../../../services/config-service/ConfigService.js";
import { ConfigKey } from "../../../services/config-service/validators.js";

/**
 * Admin API Routes for Configuration Service
 * Issue: #377
 * 
 * Endpoints:
 * - GET    /admin/configs/:environment?key=MAX_RETRIES
 * - POST   /admin/configs (create/update with audit)
 * - DELETE /admin/configs/:environment/:key
 * - GET    /admin/configs/:environment/audit
 * - POST   /admin/configs/export/:environment
 * - POST   /admin/configs/import/:environment
 */

let configService: ConfigService;

function getConfigService(): ConfigService {
  if (!configService) {
    const db = getDatabase();
    const redis = createRedisClient();
    configService = new ConfigService(db, redis);
  }
  return configService;
}

export async function adminConfigRoutes(server: FastifyInstance) {
  /**
   * GET /admin/configs/:environment
   * Get all configurations for an environment, or a specific key
   */
  server.get<{
    Params: { environment: string };
    Querystring: { key?: string };
  }>(
    "/:environment",
    {
      schema: {
        tags: ["Admin", "Config"],
        summary: "Get configurations for an environment",
        params: {
          type: "object",
          properties: {
            environment: {
              type: "string",
              enum: ["global", "dev", "staging", "prod-us-east", "prod-eu-west"],
            },
          },
          required: ["environment"],
        },
        querystring: {
          type: "object",
          properties: {
            key: { type: "string", description: "Optional: filter by specific key" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              configs: { type: "array", items: { type: "object" } },
              total: { type: "integer" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { environment } = request.params;
      const { key } = request.query;

      const service = getConfigService();

      if (key) {
        // Get specific config
        try {
          const value = await service.get(key as ConfigKey, environment);
          return reply.code(200).send({
            configs: [{ key, value, environment }],
            total: 1,
          });
        } catch (error: any) {
          return reply.code(404).send({
            error: "Configuration not found",
            message: error.message,
          });
        }
      } else {
        // Get all configs for environment
        const configs = await service.getAll(environment);
        return reply.code(200).send({
          configs,
          total: configs.length,
        });
      }
    }
  );

  /**
   * POST /admin/configs
   * Create or update a configuration with full audit trail
   */
  server.post<{
    Body: {
      environment: string;
      key: string;
      value: any;
      description?: string;
      changeReason?: string;
      changedBy: string;
    };
  }>(
    "/",
    {
      schema: {
        tags: ["Admin", "Config"],
        summary: "Create or update a configuration",
        body: {
          type: "object",
          required: ["environment", "key", "value", "changedBy"],
          properties: {
            environment: {
              type: "string",
              enum: ["global", "dev", "staging", "prod-us-east", "prod-eu-west"],
            },
            key: { type: "string" },
            value: { description: "Configuration value (any type)" },
            description: { type: "string" },
            changeReason: { type: "string" },
            changedBy: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              message: { type: "string" },
              environment: { type: "string" },
              key: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { environment, key, value, description, changeReason, changedBy } =
        request.body;

      const service = getConfigService();

      try {
        await service.set(key as ConfigKey, value, {
          environment,
          description,
          changeReason,
          changedBy,
        });

        return reply.code(201).send({
          message: "Configuration set successfully",
          environment,
          key,
        });
      } catch (error: any) {
        return reply.code(400).send({
          error: "Failed to set configuration",
          message: error.message,
        });
      }
    }
  );

  /**
   * DELETE /admin/configs/:environment/:key
   * Delete a configuration
   */
  server.delete<{
    Params: { environment: string; key: string };
    Body: { deletedBy: string; reason?: string };
  }>(
    "/:environment/:key",
    {
      schema: {
        tags: ["Admin", "Config"],
        summary: "Delete a configuration",
        params: {
          type: "object",
          properties: {
            environment: {
              type: "string",
              enum: ["global", "dev", "staging", "prod-us-east", "prod-eu-west"],
            },
            key: { type: "string" },
          },
          required: ["environment", "key"],
        },
        body: {
          type: "object",
          required: ["deletedBy"],
          properties: {
            deletedBy: { type: "string" },
            reason: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { environment, key } = request.params;
      const { deletedBy, reason } = request.body;

      const service = getConfigService();

      try {
        await service.delete(key as ConfigKey, environment, deletedBy, reason);

        return reply.code(200).send({
          message: "Configuration deleted successfully",
        });
      } catch (error: any) {
        return reply.code(404).send({
          error: "Failed to delete configuration",
          message: error.message,
        });
      }
    }
  );

  /**
   * GET /admin/configs/:environment/audit
   * Get audit trail for configurations
   */
  server.get<{
    Params: { environment: string };
    Querystring: { key?: string; limit?: number };
  }>(
    "/:environment/audit",
    {
      schema: {
        tags: ["Admin", "Config"],
        summary: "Get audit trail for configurations",
        params: {
          type: "object",
          properties: {
            environment: {
              type: "string",
              enum: ["global", "dev", "staging", "prod-us-east", "prod-eu-west"],
            },
          },
          required: ["environment"],
        },
        querystring: {
          type: "object",
          properties: {
            key: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              trail: { type: "array", items: { type: "object" } },
              total: { type: "integer" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { environment } = request.params;
      const { key, limit = 100 } = request.query;

      const service = getConfigService();

      const trail = await service.getAuditTrail(
        key as ConfigKey | undefined,
        environment,
        limit
      );

      return reply.code(200).send({
        trail,
        total: trail.length,
      });
    }
  );

  /**
   * POST /admin/configs/export/:environment
   * Export all configurations for an environment
   */
  server.post<{
    Params: { environment: string };
  }>(
    "/export/:environment",
    {
      schema: {
        tags: ["Admin", "Config"],
        summary: "Export configurations for an environment",
        params: {
          type: "object",
          properties: {
            environment: {
              type: "string",
              enum: ["global", "dev", "staging", "prod-us-east", "prod-eu-west"],
            },
          },
          required: ["environment"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              environment: { type: "string" },
              configs: { type: "object" },
              exportedAt: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { environment } = request.params;

      const service = getConfigService();

      const configs = await service.exportConfig(environment);

      return reply.code(200).send({
        environment,
        configs,
        exportedAt: new Date().toISOString(),
      });
    }
  );

  /**
   * POST /admin/configs/import/:environment
   * Import configurations for an environment (bulk operation)
   */
  server.post<{
    Params: { environment: string };
    Body: {
      configs: Record<string, any>;
      importedBy: string;
      importReason?: string;
    };
  }>(
    "/import/:environment",
    {
      schema: {
        tags: ["Admin", "Config"],
        summary: "Import configurations for an environment",
        params: {
          type: "object",
          properties: {
            environment: {
              type: "string",
              enum: ["global", "dev", "staging", "prod-us-east", "prod-eu-west"],
            },
          },
          required: ["environment"],
        },
        body: {
          type: "object",
          required: ["configs", "importedBy"],
          properties: {
            configs: { type: "object" },
            importedBy: { type: "string" },
            importReason: { type: "string" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              message: { type: "string" },
              environment: { type: "string" },
              count: { type: "integer" },
            },
          },
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { environment } = request.params;
      const { configs, importedBy, importReason } = request.body;

      const service = getConfigService();

      try {
        await service.importConfig(configs, environment, importedBy, importReason);

        return reply.code(201).send({
          message: "Configurations imported successfully",
          environment,
          count: Object.keys(configs).length,
        });
      } catch (error: any) {
        return reply.code(400).send({
          error: "Failed to import configurations",
          message: error.message,
        });
      }
    }
  );
}
