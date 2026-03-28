import type { FastifyInstance } from "fastify";
import { configService, ConfigValue } from "../../services/config.service";

export async function configRoutes(server: FastifyInstance) {
  // Get configuration value
  server.get<{ Params: { key: string } }>("/:key", async (request, reply) => {
    const { key } = request.params;
    const value = await configService.get(key);

    if (value === undefined) {
      return reply.code(404).send({ error: "Configuration not found" });
    }

    return { key, value };
  });

  // Get all configurations
  server.get("/", async (_request, _reply) => {
    const configs = await configService.getAll();
    return { configs, total: configs.length };
  });

  // Set configuration value
  server.post<{
    Body: {
      key: string;
      value: string | number | boolean | unknown[] | Record<string, unknown>;
      environment?: string;
      isSensitive?: boolean;
      createdBy: string;
    };
  }>("/", async (request, reply) => {
    const { key, value, environment, isSensitive, createdBy } = request.body;

    await configService.set(key, value as ConfigValue, {
      environment,
      isSensitive,
      createdBy,
    });

    return reply.code(201).send({ message: "Configuration set successfully" });
  });

  // Delete configuration
  server.delete<{
    Params: { key: string };
    Body: { deletedBy: string };
  }>("/:key", async (request, reply) => {
    const { key } = request.params;
    const { deletedBy } = request.body;

    await configService.delete(key, deletedBy);

    return reply
      .code(200)
      .send({ message: "Configuration deleted successfully" });
  });

  // Check feature flag
  server.get<{ Params: { name: string } }>(
    "/features/:name",
    async (request, _reply) => {
      const { name } = request.params;
      const enabled = await configService.isFeatureEnabled(name);
      return { name, enabled };
    },
  );

  // Set feature flag
  server.post<{
    Body: {
      name: string;
      enabled: boolean;
      environment?: string;
      rolloutPercentage?: number;
      conditions?: Record<string, unknown>;
    };
  }>("/features", async (request, reply) => {
    const { name, enabled, environment, rolloutPercentage, conditions } =
      request.body;

    await configService.setFeatureFlag(name, enabled, {
      environment,
      rolloutPercentage,
      conditions,
    });

    return reply.code(201).send({ message: "Feature flag set successfully" });
  });

  // Export configuration
  server.get<{ Querystring: { environment?: string } }>(
    "/export",
    async (request, _reply) => {
      const { environment } = request.query;
      const exported = await configService.exportConfig(environment);
      return exported;
    },
  );

  // Import configuration
  server.post<{
    Body: {
      configs: Record<string, ConfigValue>;
      importedBy: string;
      environment?: string;
    };
  }>("/import", async (request, reply) => {
    const { configs, importedBy, environment } = request.body;

    await configService.importConfig(configs, importedBy, environment);

    return reply
      .code(201)
      .send({ message: "Configuration imported successfully" });
  });

  // Get audit trail
  server.get<{ Querystring: { key?: string; limit?: number } }>(
    "/audit",
    async (request, _reply) => {
      const { key, limit } = request.query;
      const trail = await configService.getAuditTrail(key, limit);
      return { trail, total: trail.length };
    },
  );

  // Clear cache
  server.post("/cache/clear", async (_request, reply) => {
    configService.clearCache();
    return reply.code(200).send({ message: "Cache cleared successfully" });
  });
}
