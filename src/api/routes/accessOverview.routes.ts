import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { accessOverviewService } from "../../services/accessOverview.service.js";

const summarySchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  roles: z.record(z.array(z.string())),
});

export async function accessOverviewRoutes(server: FastifyInstance) {
  server.get("/", {
    schema: {
      tags: ["Admin"],
      summary: "List workspace access summaries (admin)",
      response: { 200: { type: "object", additionalProperties: true } },
    },
  }, async () => {
    return { workspaces: await accessOverviewService.listSummaries() };
  });

  server.post("/", {
    schema: {
      tags: ["Admin"],
      summary: "Create or register a workspace access summary",
      body: { type: "object", additionalProperties: true },
      response: { 201: { type: "object", additionalProperties: true } },
    },
  }, async (request, reply) => {
    const parsed = summarySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid body" });
    const item = await accessOverviewService.addSummary(parsed.data as any);
    return reply.status(201).send(item);
  });
}
