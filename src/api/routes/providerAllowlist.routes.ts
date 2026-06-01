import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { providerAllowlistService } from "../../services/providerAllowlist.service.js";

export async function providerAllowlistRoutes(server: FastifyInstance) {
  server.get(
    "/",
    {
      schema: {
        tags: ["Providers"],
        summary: "List provider allowlist entries",
        response: {
          200: {
            type: "object",
            properties: {
              enforcement: { type: "string", enum: ["open", "allowlist"] },
              total: { type: "integer" },
              entries: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const entries = await providerAllowlistService.listEntries();
      const enforcement = entries.length > 0 ? "allowlist" : "open";
      return reply.send({ enforcement, total: entries.length, entries });
    }
  );

  server.get<{ Params: { providerKey: string } }>(
    "/:providerKey",
    {
      schema: {
        tags: ["Providers"],
        summary: "Lookup provider allowlist status",
        params: {
          type: "object",
          required: ["providerKey"],
          properties: {
            providerKey: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              providerKey: { type: "string" },
              allowed: { type: "boolean" },
              enforcement: { type: "string", enum: ["open", "allowlist"] },
              entry: { type: "object", nullable: true, additionalProperties: true },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { providerKey: string } }>, reply: FastifyReply) => {
      const { providerKey } = request.params;
      const [entry, allowed] = await Promise.all([
        providerAllowlistService.getEntry(providerKey),
        providerAllowlistService.isAllowed(providerKey),
      ]);
      const enforcement = allowed && !entry ? "open" : "allowlist";
      return reply.send({ providerKey: providerKey.toLowerCase(), allowed, enforcement, entry });
    }
  );
}
