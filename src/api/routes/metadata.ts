import type { FastifyInstance } from "fastify";
import { assetMetadataService } from "../../services/assetMetadata.service";
import { assetMetadataSyncService } from "../../services/assetMetadataSync.service.js";

const metadataBodySchema = {
  type: "object",
  properties: {
    logo_url: { type: "string", format: "uri" },
    description: { type: "string" },
    website_url: { type: "string", format: "uri" },
    contract_address: { type: "string" },
    social_links: { type: "object", additionalProperties: { type: "string" } },
    documentation_url: { type: "string", format: "uri" },
    token_specifications: { type: "object", additionalProperties: true },
    category: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
};

export async function metadataRoutes(server: FastifyInstance) {
  server.post<{
    Body: {
      symbols?: string[];
      fields?: Array<
        | "logo_url"
        | "description"
        | "website_url"
        | "documentation_url"
        | "category"
        | "tags"
        | "social_links"
        | "token_specifications"
      >;
      force?: boolean;
      triggeredBy?: string;
    };
  }>(
    "/admin/sync",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Run asset metadata sync job",
        body: {
          type: "object",
          properties: {
            symbols: { type: "array", items: { type: "string" } },
            fields: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "logo_url",
                  "description",
                  "website_url",
                  "documentation_url",
                  "category",
                  "tags",
                  "social_links",
                  "token_specifications",
                ],
              },
            },
            force: { type: "boolean" },
            triggeredBy: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              total: { type: "integer" },
              results: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await assetMetadataSyncService.syncAll({
        symbols: request.body.symbols,
        fields: request.body.fields,
        force: request.body.force,
        triggeredBy: request.body.triggeredBy ?? "admin-api",
      });

      return reply.code(200).send(result);
    },
  );

  server.post<{
    Params: { assetId: string };
    Body: { override: boolean; reason?: string; changedBy: string };
  }>(
    "/:assetId/override",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Set or clear metadata manual override",
        params: {
          type: "object",
          required: ["assetId"],
          properties: { assetId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["override", "changedBy"],
          properties: {
            override: { type: "boolean" },
            reason: { type: "string" },
            changedBy: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { message: { type: "string" } } },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      try {
        await assetMetadataSyncService.setManualOverride(
          request.params.assetId,
          request.body.override,
          request.body.reason ?? null,
          request.body.changedBy,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("not found")) {
          return reply.code(404).send({ error: message });
        }
        throw error;
      }

      return reply.code(200).send({ message: "Manual override updated" });
    },
  );

  server.get<{ Params: { symbol: string }; Querystring: { limit?: number } }>(
    "/symbol/:symbol/sync-history",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Get metadata sync history for a symbol",
        params: {
          type: "object",
          required: ["symbol"],
          properties: { symbol: { type: "string", example: "USDC" } },
        },
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              history: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const history = await assetMetadataSyncService.getSyncHistory(
        request.params.symbol,
        request.query.limit ?? 50,
      );
      return {
        symbol: request.params.symbol.toUpperCase(),
        history,
      };
    },
  );

  server.get(
    "/",
    {
      schema: {
        tags: ["Metadata"],
        summary: "List all asset metadata",
        response: {
          200: {
            type: "object",
            properties: {
              metadata: { type: "array", items: { type: "object", additionalProperties: true } },
              total: { type: "integer" },
            },
          },
        },
      },
    },
    async (_request, _reply) => {
      const metadataList = await assetMetadataService.getAllMetadata();
      return { metadata: metadataList, total: metadataList.length };
    },
  );

  server.get<{ Querystring: { q: string } }>(
    "/search",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Search asset metadata",
        querystring: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string", description: "Search query", example: "stable" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              query: { type: "string" },
              metadata: { type: "array", items: { type: "object", additionalProperties: true } },
              total: { type: "integer" },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { q } = request.query;
      const metadataList = await assetMetadataService.searchMetadata(q);
      return { query: q, metadata: metadataList, total: metadataList.length };
    },
  );

  server.get<{ Params: { symbol: string } }>(
    "/symbol/:symbol",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Get metadata by symbol",
        params: {
          type: "object",
          required: ["symbol"],
          properties: { symbol: { type: "string", example: "USDC" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const { symbol } = request.params;
      const metadata = await assetMetadataService.getMetadataBySymbol(symbol);
      if (!metadata) {
        return reply.code(404).send({ error: "Metadata not found" });
      }
      return metadata;
    },
  );

  server.get<{ Params: { category: string } }>(
    "/category/:category",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Get metadata by category",
        params: {
          type: "object",
          required: ["category"],
          properties: { category: { type: "string", example: "stablecoin" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              category: { type: "string" },
              metadata: { type: "array", items: { type: "object", additionalProperties: true } },
              total: { type: "integer" },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { category } = request.params;
      const metadataList = await assetMetadataService.getMetadataByCategory(category);
      return { category, metadata: metadataList, total: metadataList.length };
    },
  );

  server.get<{ Params: { assetId: string } }>(
    "/:assetId",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Get metadata by asset ID",
        params: {
          type: "object",
          required: ["assetId"],
          properties: { assetId: { type: "string", example: "asset_usdc_stellar" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const { assetId } = request.params;
      const metadata = await assetMetadataService.getMetadata(assetId);
      if (!metadata) {
        return reply.code(404).send({ error: "Metadata not found" });
      }
      return metadata;
    },
  );

  server.get<{ Params: { assetId: string } }>(
    "/:assetId/history",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Get metadata version history",
        params: {
          type: "object",
          required: ["assetId"],
          properties: { assetId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              assetId: { type: "string" },
              history: { type: "array", items: { type: "object", additionalProperties: true } },
              total: { type: "integer" },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { assetId } = request.params;
      const history = await assetMetadataService.getVersionHistory(assetId);
      return { assetId, history, total: history.length };
    },
  );

  server.post<{
    Body: {
      assetId: string;
      symbol: string;
      metadata: Record<string, unknown>;
      updatedBy: string;
    };
  }>(
    "/",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Create or update asset metadata",
        body: {
          type: "object",
          required: ["assetId", "symbol", "metadata", "updatedBy"],
          properties: {
            assetId: { type: "string" },
            symbol: { type: "string" },
            metadata: metadataBodySchema,
            updatedBy: { type: "string" },
          },
        },
        response: {
          201: { type: "object", additionalProperties: true },
          400: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const { assetId, symbol, metadata, updatedBy } = request.body;
      const validation = assetMetadataService.validateMetadata(metadata);
      if (!validation.valid) {
        return reply.code(400).send({ errors: validation.errors });
      }
      const result = await assetMetadataService.upsertMetadata(assetId, symbol, metadata as any, updatedBy);
      return reply.code(201).send(result);
    },
  );

  server.patch<{
    Params: { assetId: string };
    Body: { logoUrl: string; updatedBy: string };
  }>(
    "/:assetId/logo",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Update asset logo",
        params: {
          type: "object",
          required: ["assetId"],
          properties: { assetId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["logoUrl", "updatedBy"],
          properties: {
            logoUrl: { type: "string", format: "uri" },
            updatedBy: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { assetId } = request.params;
      const { logoUrl, updatedBy } = request.body;
      await assetMetadataService.updateLogo(assetId, logoUrl, updatedBy);
      return reply.code(200).send({ message: "Logo updated successfully" });
    },
  );

  server.delete<{ Params: { assetId: string } }>(
    "/:assetId",
    {
      schema: {
        tags: ["Metadata"],
        summary: "Delete asset metadata",
        params: {
          type: "object",
          required: ["assetId"],
          properties: { assetId: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { assetId } = request.params;
      await assetMetadataService.deleteMetadata(assetId);
      return reply.code(200).send({ message: "Metadata deleted successfully" });
    },
  );
}
