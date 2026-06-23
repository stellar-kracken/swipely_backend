import type { FastifyInstance } from "fastify";
import { escalationService } from "../../services/escalation.service";
import { IncidentService } from "../../services/incident.service.js";

export async function incidentsRoutes(server: FastifyInstance) {
  const incidentService = new IncidentService();

  // Create incident
  server.post("/", async (request, reply) => {
    const incident = await escalationService.createIncident(
      request.body as any,
    );
    return reply.code(201).send(incident);
  });

  // Get incident
  server.get<{ Params: { incidentId: string } }>(
    "/:incidentId",
    async (request, reply) => {
      const incident = await escalationService.getIncident(
        request.params.incidentId,
      );
      if (!incident) {
        return reply.code(404).send({ error: "Incident not found" });
      }
      return incident;
    },
  );

  // Acknowledge incident
  server.post<{
    Params: { incidentId: string };
    Body: { acknowledgedBy: string };
  }>("/:incidentId/acknowledge", async (request, reply) => {
    await escalationService.acknowledgeIncident(
      request.params.incidentId,
      request.body.acknowledgedBy,
    );
    return reply.code(200).send({ message: "Incident acknowledged" });
  });

  // Resolve incident
  server.post<{ Params: { incidentId: string }; Body: { resolvedBy: string } }>(
    "/:incidentId/resolve",
    async (request, reply) => {
      await escalationService.resolveIncident(
        request.params.incidentId,
        request.body.resolvedBy,
      );
      return reply.code(200).send({ message: "Incident resolved" });
    },
  );

  // Escalate incident manually
  server.post<{ Params: { incidentId: string }; Body: { reason: string } }>(
    "/:incidentId/escalate",
    async (request, reply) => {
      await escalationService.escalateIncident(
        request.params.incidentId,
        request.body.reason,
        "manual",
      );
      return reply.code(200).send({ message: "Incident escalated" });
    },
  );

  // Get escalation history
  server.get<{ Params: { incidentId: string } }>(
    "/:incidentId/history",
    async (request, _reply) => {
      const history = await escalationService.getEscalationHistory(
        request.params.incidentId,
      );
      return { history, total: history.length };
    },
  );

  // Create escalation rule
  server.post("/rules", async (request, reply) => {
    const rule = await escalationService.createEscalationRule(
      request.body as any,
    );
    return reply.code(201).send(rule);
  });

  // Get all escalation rules
  server.get("/rules", async (_request, _reply) => {
    const rules = await escalationService.getAllRules();
    return { rules, total: rules.length };
  });

  // Start escalation engine
  server.post("/engine/start", async (_request, reply) => {
    escalationService.startEngine();
    return reply.code(200).send({ message: "Escalation engine started" });
  });

  // Stop escalation engine
  server.post("/engine/stop", async (_request, reply) => {
    escalationService.stopEngine();
    return reply.code(200).send({ message: "Escalation engine stopped" });
  });

  // Heatmap data
  server.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      assetSymbol?: string;
    };
  }>("/heatmap", async (request, reply) => {
    const { startDate, endDate, assetSymbol } = request.query;

    const heatmap = await incidentService.getHeatmapData({
      startDate,
      endDate,
      assetSymbol,
    });

    return heatmap;
  });
}
