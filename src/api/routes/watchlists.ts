import type { FastifyInstance } from "fastify";
import { WatchlistsService } from "../../services/watchlists.service.js";

const userIdParamSchema = {
  type: "object",
  required: ["userId"],
  properties: {
    userId: { type: "string", minLength: 1 },
  },
} as const;

const watchlistIdParamSchema = {
  type: "object",
  required: ["userId", "id"],
  properties: {
    userId: { type: "string", minLength: 1 },
    id: { type: "string", format: "uuid" },
  },
} as const;

export async function watchlistsRoutes(server: FastifyInstance) {
  const watchlistsService = new WatchlistsService();

  // GET /api/v1/watchlists/:userId
  server.get<{ Params: { userId: string } }>(
    "/:userId",
    { schema: { params: userIdParamSchema } },
    async (request) => {
      const { userId } = request.params;
      const watchlists = await watchlistsService.getWatchlists(userId);
      return { watchlists };
    }
  );

  // POST /api/v1/watchlists/:userId
  server.post<{
    Params: { userId: string };
    Body: { name: string; isDefault?: boolean };
  }>(
    "/:userId",
    { schema: { params: userIdParamSchema } },
    async (request, reply) => {
      const { userId } = request.params;
      const { name, isDefault } = request.body;
      
      if (!name) return reply.status(400).send({ error: "Name is required" });

      try {
        const watchlist = await watchlistsService.createWatchlist(userId, name, isDefault);
        return { watchlist };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );

  // DELETE /api/v1/watchlists/:userId/:id
  server.delete<{ Params: { userId: string; id: string } }>(
    "/:userId/:id",
    { schema: { params: watchlistIdParamSchema } },
    async (request, reply) => {
      const { userId, id } = request.params;
      await watchlistsService.deleteWatchlist(userId, id);
      return { success: true };
    }
  );

  // PATCH /api/v1/watchlists/:userId/:id
  server.patch<{
    Params: { userId: string; id: string };
    Body: { name?: string; isDefault?: boolean; assets?: string[] };
  }>(
    "/:userId/:id",
    { schema: { params: watchlistIdParamSchema } },
    async (request, reply) => {
      const { userId, id } = request.params;
      const { name, isDefault, assets } = request.body;

      try {
        if (name !== undefined) {
          await watchlistsService.renameWatchlist(userId, id, name);
        }
        if (isDefault !== undefined && isDefault) {
          await watchlistsService.setWatchlistDefault(userId, id);
        }
        if (assets !== undefined) {
          await watchlistsService.updateWatchlistAssets(userId, id, assets);
        }
        
        return { success: true };
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
  );
}
