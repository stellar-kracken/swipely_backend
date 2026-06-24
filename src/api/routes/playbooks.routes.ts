import type { FastifyInstance } from "fastify";
import { playbookService } from "../../services/playbook.service.js";

export async function playbooksRoutes(server: FastifyInstance) {
  server.get<{ Querystring: { q?: string; alertType?: string; severity?: string } }>(
    "/",
    {
      schema: {
        tags: ["Playbooks"],
        summary: "Search alert playbooks",
        querystring: {
          type: "object",
          properties: {
            q: { type: "string" },
            alertType: { type: "string" },
            severity: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      return playbookService.searchPlaybooks(
        request.query.q,
        request.query.alertType,
        request.query.severity,
      );
    },
  );

  server.get<{ Params: { id: string } }>(
    "/:id",
    {
      schema: {
        tags: ["Playbooks"],
        summary: "Get alert playbook by id or alert type",
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const playbook = await playbookService.getPlaybook(request.params.id);
      if (!playbook) return reply.status(404).send({ error: "Playbook not found" });
      return playbook;
    },
  );
}
