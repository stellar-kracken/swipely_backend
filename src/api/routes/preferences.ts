import type { FastifyInstance } from "fastify";
import {
  bulkPreferenceUpdateSchema,
  categorySchema,
  importPreferencesSchema,
  singlePreferenceUpdateSchema,
} from "../../services/preferences.validation.js";
import { PreferencesService } from "../../services/preferences.service.js";

const userIdParamSchema = {
  type: "object",
  required: ["userId"],
  properties: {
    userId: { type: "string", minLength: 1 },
  },
} as const;

export async function preferencesRoutes(server: FastifyInstance) {
  const preferencesService = new PreferencesService();

  // GET /api/v1/preferences/:userId
  server.get<{ Params: { userId: string } }>(
    "/:userId",
    { schema: { params: userIdParamSchema } },
    async (request) => {
      const { userId } = request.params;
      const preferences = await preferencesService.getPreferences(userId);
      return { preferences };
    }
  );

  // GET /api/v1/preferences/:userId/:category/:key
  server.get<{
    Params: { userId: string; category: string; key: string };
  }>("/:userId/:category/:key", async (request, reply) => {
    const { userId, category, key } = request.params;
    const parsedCategory = categorySchema.safeParse(category);
    if (!parsedCategory.success) {
      return reply.status(400).send({ error: "Invalid preference category" });
    }

    try {
      const value = await preferencesService.getPreference(
        userId,
        parsedCategory.data,
        key
      );

      if (value === null) {
        return reply.status(404).send({ error: "Preference key not found" });
      }

      return { category: parsedCategory.data, key, value };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  // PUT /api/v1/preferences/:userId/:category/:key
  server.put<{
    Params: { userId: string; category: string; key: string };
    Body: { value: unknown };
  }>("/:userId/:category/:key", async (request, reply) => {
    const { userId, category, key } = request.params;
    const categoryResult = categorySchema.safeParse(category);
    const bodyResult = singlePreferenceUpdateSchema.safeParse(request.body);

    if (!categoryResult.success) {
      return reply.status(400).send({ error: "Invalid preference category" });
    }

    if (!bodyResult.success) {
      return reply.status(400).send({ error: bodyResult.error.flatten() });
    }

    try {
      const preferences = await preferencesService.setPreference(
        userId,
        categoryResult.data,
        key,
        bodyResult.data.value
      );
      return { preferences };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  // PATCH /api/v1/preferences/:userId/bulk
  server.patch<{
    Params: { userId: string };
    Body: {
      expectedVersion?: number;
      updates: {
        notifications?: Record<string, unknown>;
        display?: Record<string, unknown>;
        alerts?: Record<string, unknown>;
      };
    };
  }>("/:userId/bulk", async (request, reply) => {
    const bodyResult = bulkPreferenceUpdateSchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({ error: bodyResult.error.flatten() });
    }

    try {
      const preferences = await preferencesService.bulkUpdatePreferences(
        request.params.userId,
        bodyResult.data.updates,
        bodyResult.data.expectedVersion
      );
      return { preferences };
    } catch (error) {
      const message = (error as Error).message;
      if (message.startsWith("Version conflict")) {
        return reply.status(409).send({ error: message });
      }

      return reply.status(400).send({ error: message });
    }
  });

  // DELETE /api/v1/preferences/:userId/:category/:key
  server.delete<{
    Params: { userId: string; category: string; key: string };
  }>("/:userId/:category/:key", async (request, reply) => {
    const { userId, category, key } = request.params;
    const categoryResult = categorySchema.safeParse(category);
    if (!categoryResult.success) {
      return reply.status(400).send({ error: "Invalid preference category" });
    }

    try {
      const preferences = await preferencesService.resetPreference(
        userId,
        categoryResult.data,
        key
      );
      return { preferences };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  // GET /api/v1/preferences/:userId/export
  server.get<{ Params: { userId: string } }>("/:userId/export", async (request) => {
    const payload = await preferencesService.exportPreferences(request.params.userId);
    return { data: payload };
  });

  // POST /api/v1/preferences/:userId/import
  server.post<{
    Params: { userId: string };
    Body: {
      overwrite?: boolean;
      data: {
        schemaVersion: number;
        categories: Record<string, Record<string, unknown>>;
      };
    };
  }>("/:userId/import", async (request, reply) => {
    const payloadResult = importPreferencesSchema.safeParse(request.body);
    if (!payloadResult.success) {
      return reply.status(400).send({ error: payloadResult.error.flatten() });
    }

    try {
      const preferences = await preferencesService.importPreferences(
        request.params.userId,
        {
          schemaVersion: payloadResult.data.data.schemaVersion,
          categories: payloadResult.data.data.categories,
        },
        payloadResult.data.overwrite
      );
      return { preferences };
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  // GET /api/v1/preferences/:userId/stream
  server.get<{ Params: { userId: string } }>(
    "/:userId/stream",
    async (request, reply) => {
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.flushHeaders();

      const send = (eventName: string, payload: unknown) => {
        reply.raw.write(`event: ${eventName}\n`);
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      send("connected", {
        userId: request.params.userId,
        time: new Date().toISOString(),
      });

      const unsubscribe = preferencesService.onPreferencesUpdated((event) => {
        if (event.userId !== request.params.userId) {
          return;
        }

        send("preferencesUpdated", event);
      });

      request.raw.on("close", () => {
        unsubscribe();
      });

      return reply;
    }
  );
}
