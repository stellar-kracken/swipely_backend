import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { incidentTimelineService } from "../../services/incidentTimeline.service.js";

const eventSchema = z.object({
  type: z.string(),
  actor: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  occurredAt: z.string().optional(),
});

export async function incidentTimelineRoutes(server: FastifyInstance) {
  // GET timeline for an incident
  server.get<{ Params: { id: string } }>("/:id/timeline", {
    schema: {
      tags: ["Incidents"],
      summary: "Get timeline for an incident",
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } },
    },
  }, async (request, _reply) => {
    return incidentTimelineService.getTimeline(request.params.id);
  });

  // POST add timeline event
  server.post<{ Params: { id: string }; Body: z.infer<typeof eventSchema> }>("/:id/timeline", {
    schema: {
      tags: ["Incidents"],
      summary: "Add an event to an incident timeline",
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", additionalProperties: true },
      response: { 201: { type: "object", additionalProperties: true } },
    },
  }, async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Invalid event payload" });
    const event = await incidentTimelineService.addEvent(request.params.id, parsed.data as any);
    return reply.status(201).send(event);
  });
}
