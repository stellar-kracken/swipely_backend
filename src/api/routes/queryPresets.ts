import type { FastifyInstance, FastifyRequest } from "fastify";
import { queryPresetService } from "../../services/queryPreset.service.js";
import { logger } from "../../utils/logger.js";

interface CreatePresetBody {
  name: string;
  description?: string;
  category: string;
  query_definition: Record<string, unknown>;
  is_shared?: boolean;
  access_rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface UpdatePresetBody {
  name?: string;
  description?: string;
  category?: string;
  query_definition?: Record<string, unknown>;
  is_shared?: boolean;
  access_rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  change_notes?: string;
}

interface PresetParams {
  id: string;
}

interface ListPresetsQuery {
  category?: string;
  is_shared?: string;
  search?: string;
}

function getRequestUserId(request: FastifyRequest): string {
  return request.apiKeyAuth?.id ?? "00000000-0000-0000-0000-000000000000";
}

export async function queryPresetsRoutes(server: FastifyInstance) {
  // Create preset
  server.post<{ Body: CreatePresetBody }>(
    "/",
    {
      schema: {
        tags: ["Query Presets"],
        description: "Create a new query preset",
        body: {
          type: "object",
          required: ["name", "category", "query_definition"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            category: { type: "string" },
            query_definition: { type: "object" },
            is_shared: { type: "boolean" },
            access_rules: { type: "object" },
            metadata: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = getRequestUserId(request);

        // Validate query definition
        const isValid = await queryPresetService.validateQueryDefinition(
          request.body.query_definition,
        );

        if (!isValid) {
          return reply.status(400).send({
            error: "Invalid query definition format",
          });
        }

        const preset = await queryPresetService.createPreset({
          ...request.body,
          created_by: userId,
        });

        reply.status(201).send(preset);
      } catch (error) {
        logger.error({ error }, "Failed to create query preset");
        reply.status(500).send({ error: "Failed to create query preset" });
      }
    },
  );

  // List presets
  server.get<{ Querystring: ListPresetsQuery }>(
    "/",
    {
      schema: {
        tags: ["Query Presets"],
        description: "List query presets",
        querystring: {
          type: "object",
          properties: {
            category: { type: "string" },
            is_shared: { type: "string" },
            search: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = getRequestUserId(request);

        const filters = {
          category: request.query.category,
          is_shared: request.query.is_shared === "true" ? true : undefined,
          search: request.query.search,
        };

        const presets = await queryPresetService.listPresets(userId, filters);

        reply.send(presets);
      } catch (error) {
        logger.error({ error }, "Failed to list query presets");
        reply.status(500).send({ error: "Failed to list query presets" });
      }
    },
  );

  // Get preset by ID
  server.get<{ Params: PresetParams }>(
    "/:id",
    {
      schema: {
        tags: ["Query Presets"],
        description: "Get a query preset by ID",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = getRequestUserId(request);

        const preset = await queryPresetService.getPresetById(
          request.params.id,
          userId,
        );

        if (!preset) {
          return reply.status(404).send({ error: "Preset not found" });
        }

        // Record usage
        await queryPresetService.recordUsage(request.params.id);

        reply.send(preset);
      } catch (error) {
        logger.error(
          { error, presetId: request.params.id },
          "Failed to get query preset",
        );
        reply.status(500).send({ error: "Failed to get query preset" });
      }
    },
  );

  // Update preset
  server.patch<{ Params: PresetParams; Body: UpdatePresetBody }>(
    "/:id",
    {
      schema: {
        tags: ["Query Presets"],
        description: "Update a query preset",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            category: { type: "string" },
            query_definition: { type: "object" },
            is_shared: { type: "boolean" },
            access_rules: { type: "object" },
            metadata: { type: "object" },
            change_notes: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = getRequestUserId(request);

        // Validate query definition if provided
        if (request.body.query_definition) {
          const isValid = await queryPresetService.validateQueryDefinition(
            request.body.query_definition,
          );

          if (!isValid) {
            return reply.status(400).send({
              error: "Invalid query definition format",
            });
          }
        }

        const preset = await queryPresetService.updatePreset(
          request.params.id,
          userId,
          {
            ...request.body,
            updated_by: userId,
          },
        );

        if (!preset) {
          return reply
            .status(404)
            .send({ error: "Preset not found or access denied" });
        }

        reply.send(preset);
      } catch (error) {
        logger.error(
          { error, presetId: request.params.id },
          "Failed to update query preset",
        );
        reply.status(500).send({ error: "Failed to update query preset" });
      }
    },
  );

  // Delete preset
  server.delete<{ Params: PresetParams }>(
    "/:id",
    {
      schema: {
        tags: ["Query Presets"],
        description: "Delete a query preset",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = getRequestUserId(request);

        const success = await queryPresetService.deletePreset(
          request.params.id,
          userId,
        );

        if (!success) {
          return reply
            .status(404)
            .send({ error: "Preset not found or access denied" });
        }

        reply.status(204).send();
      } catch (error) {
        logger.error(
          { error, presetId: request.params.id },
          "Failed to delete query preset",
        );
        reply.status(500).send({ error: "Failed to delete query preset" });
      }
    },
  );

  // Get preset versions
  server.get<{ Params: PresetParams }>(
    "/:id/versions",
    {
      schema: {
        tags: ["Query Presets"],
        description: "Get version history of a query preset",
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = getRequestUserId(request);

        const versions = await queryPresetService.getPresetVersions(
          request.params.id,
          userId,
        );

        reply.send(versions);
      } catch (error) {
        logger.error(
          { error, presetId: request.params.id },
          "Failed to get preset versions",
        );
        reply.status(500).send({ error: "Failed to get preset versions" });
      }
    },
  );
}
