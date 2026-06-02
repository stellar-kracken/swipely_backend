import type { FastifyInstance } from "fastify";
import { providerHealthRegistryService } from "../../services/providerHealthRegistry.service.js";

export async function sourceHealthRoutes(server: FastifyInstance) {
  server.get("/", {
    schema: {
      tags: ["Health"],
      summary: "List source health and freshness information",
      response: { 200: { type: "object", additionalProperties: true } },
    },
  }, async () => {
    const data = await providerHealthRegistryService.listRegistry();
    return data;
  });
}
