import type { FastifyInstance } from "fastify";
import { getCorrelationService } from "../../services/correlation.service.js";
import { authMiddleware } from "../middleware/auth.js";

export async function incidentCorrelationRoutes(server: FastifyInstance) {
  const svc = getCorrelationService();

  // GET /api/v1/incidents/:id/correlations/suggestions
  server.get<{ Params: { id: string }; Querystring: { lookbackHours?: string } }>(
    "/:id/correlations/suggestions",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Get automated correlation suggestions for an incident",
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        response: { 200: { type: "array", items: { type: "object", additionalProperties: true } } },
      },
    },
    async (request, _reply) => {
      const lookback = request.query.lookbackHours ? Number(request.query.lookbackHours) : 24;
      const suggestions = await svc.suggestForIncident(request.params.id, lookback);
      return { suggestions };
    }
  );

  // POST /api/v1/incidents/:id/correlations/link
  server.post<{ Params: { id: string }; Body: { targetIncidentId: string; actor?: string } }>(
    "/:id/correlations/link",
    {
      preHandler: authMiddleware({ requiredScopes: ["admin", "operator"] }),
      schema: {
        tags: ["Incidents"],
        summary: "Manually link two incidents into a correlation group",
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: { type: "object", required: ["targetIncidentId"], properties: { targetIncidentId: { type: "string" }, actor: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { targetIncidentId, actor } = request.body;
      try {
        const res = await svc.linkIncidents(request.params.id, targetIncidentId, actor);
        return reply.status(200).send(res);
      } catch (e: any) {
        request.log.error({ err: e }, "Failed to link incidents");
        return reply.status(500).send({ error: "Failed to link incidents" });
      }
    }
  );

  // POST /api/v1/incidents/:id/correlations/unlink
  server.post<{ Params: { id: string }; Body: { targetIncidentId: string; actor?: string } }>(
    "/:id/correlations/unlink",
    {
      preHandler: authMiddleware({ requiredScopes: ["admin", "operator"] }),
      schema: {
        tags: ["Incidents"],
        summary: "Unlink two incidents from a correlation group",
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: { type: "object", required: ["targetIncidentId"], properties: { targetIncidentId: { type: "string" }, actor: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { targetIncidentId, actor } = request.body;
      try {
        const res = await svc.unlinkIncidents(request.params.id, targetIncidentId, actor);
        return reply.status(200).send(res);
      } catch (e: any) {
        request.log.error({ err: e }, "Failed to unlink incidents");
        return reply.status(500).send({ error: "Failed to unlink incidents" });
      }
    }
  );

  // POST /api/v1/incidents/:id/correlations/approve
  server.post<{ Params: { id: string }; Body: { targetIncidentId: string; actor?: string } }>(
    "/:id/correlations/approve",
    {
      preHandler: authMiddleware({ requiredScopes: ["admin", "operator"] }),
      schema: {
        tags: ["Incidents"],
        summary: "Approve an automated merge suggestion",
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        body: { type: "object", required: ["targetIncidentId"], properties: { targetIncidentId: { type: "string" }, actor: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { targetIncidentId, actor } = request.body;
      try {
        const res = await svc.approveSuggestion(request.params.id, targetIncidentId, actor);
        return reply.status(200).send(res);
      } catch (e: any) {
        request.log.error({ err: e }, "Failed to approve suggestion");
        return reply.status(500).send({ error: "Failed to approve suggestion" });
      }
    }
  );

  // GET /api/v1/incidents/:id/correlations/group — list group members
  server.get<{ Params: { id: string } }>(
    "/:id/correlations/group",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Get correlation group for an incident",
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      try {
        const group = await svc.getGroupForIncident(request.params.id);
        if (!group) return reply.status(404).send({ error: "No correlation group found" });
        const members = await svc.listGroupMembers(group.id);
        return { group, members };
      } catch (e: any) {
        request.log.error({ err: e }, "Failed to fetch correlation group");
        return reply.status(500).send({ error: "Failed to fetch correlation group" });
      }
    }
  );
}
