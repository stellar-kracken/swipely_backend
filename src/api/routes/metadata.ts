import type { FastifyInstance } from "fastify";
import { assetMetadataService } from "../../services/assetMetadata.service";

export async function metadataRoutes(server: FastifyInstance) {
  // Get metadata by asset ID
  server.get<{ Params: { assetId: string } }>(
    "/:assetId",
    async (request, reply) => {
      const { assetId } = request.params;
      const metadata = await assetMetadataService.getMetadata(assetId);

      if (!metadata) {
        return reply.code(404).send({ error: "Metadata not found" });
      }

      return metadata;
    },
  );

  // Get metadata by symbol
  server.get<{ Params: { symbol: string } }>(
    "/symbol/:symbol",
    async (request, reply) => {
      const { symbol } = request.params;
      const metadata = await assetMetadataService.getMetadataBySymbol(symbol);

      if (!metadata) {
        return reply.code(404).send({ error: "Metadata not found" });
      }

      return metadata;
    },
  );

  // Get all metadata
  server.get("/", async (_request, _reply) => {
    const metadataList = await assetMetadataService.getAllMetadata();
    return { metadata: metadataList, total: metadataList.length };
  });

  // Get metadata by category
  server.get<{ Params: { category: string } }>(
    "/category/:category",
    async (request, _reply) => {
      const { category } = request.params;
      const metadataList =
        await assetMetadataService.getMetadataByCategory(category);
      return { category, metadata: metadataList, total: metadataList.length };
    },
  );

  // Search metadata
  server.get<{ Querystring: { q: string } }>(
    "/search",
    async (request, _reply) => {
      const { q } = request.query;
      const metadataList = await assetMetadataService.searchMetadata(q);
      return { query: q, metadata: metadataList, total: metadataList.length };
    },
  );

  // Create or update metadata
  server.post<{
    Body: {
      assetId: string;
      symbol: string;
      metadata: {
        logo_url?: string;
        description?: string;
        website_url?: string;
        contract_address?: string;
        social_links?: Record<string, string>;
        documentation_url?: string;
        token_specifications?: Record<string, unknown>;
        category?: string;
        tags?: string[];
      };
      updatedBy: string;
    };
  }>("/", async (request, reply) => {
    const { assetId, symbol, metadata, updatedBy } = request.body;

    // Validate metadata
    const validation = assetMetadataService.validateMetadata(metadata);
    if (!validation.valid) {
      return reply.code(400).send({ errors: validation.errors });
    }

    const result = await assetMetadataService.upsertMetadata(
      assetId,
      symbol,
      metadata,
      updatedBy,
    );

    return reply.code(201).send(result);
  });

  // Update logo
  server.patch<{
    Params: { assetId: string };
    Body: { logoUrl: string; updatedBy: string };
  }>("/:assetId/logo", async (request, reply) => {
    const { assetId } = request.params;
    const { logoUrl, updatedBy } = request.body;

    await assetMetadataService.updateLogo(assetId, logoUrl, updatedBy);

    return reply.code(200).send({ message: "Logo updated successfully" });
  });

  // Get version history
  server.get<{ Params: { assetId: string } }>(
    "/:assetId/history",
    async (request, _reply) => {
      const { assetId } = request.params;
      const history = await assetMetadataService.getVersionHistory(assetId);
      return { assetId, history, total: history.length };
    },
  );

  // Delete metadata
  server.delete<{ Params: { assetId: string } }>(
    "/:assetId",
    async (request, reply) => {
      const { assetId } = request.params;

      await assetMetadataService.deleteMetadata(assetId);

      return reply.code(200).send({ message: "Metadata deleted successfully" });
    },
  );
}
