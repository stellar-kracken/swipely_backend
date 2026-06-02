import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { alertWindowingService } from "../../services/alertWindowing.service.js";

interface AssignBody {
  id: string;
  ruleId: string;
  assetCode: string;
  alertType: string;
  priority: string;
  triggeredValue: number;
  threshold: number;
  occurredAt: string;
}

interface WindowParams {
  id: string;
}

interface ListQuery {
  assetCode?: string;
  alertType?: string;
  status?: string;
  limit?: string;
  offset?: string;
}

export async function alertWindowingRoutes(server: FastifyInstance) {
  server.post<{ Body: AssignBody }>(
    "/assign",
    async (request: FastifyRequest<{ Body: AssignBody }>, reply: FastifyReply) => {
      try {
        const { id, ruleId, assetCode, alertType, priority, triggeredValue, threshold, occurredAt } = request.body;
        const window = await alertWindowingService.assignToWindow({
          id,
          ruleId,
          assetCode,
          alertType,
          priority,
          triggeredValue,
          threshold,
          occurredAt: new Date(occurredAt),
        });
        return reply.code(201).send(window);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to assign alert to window";
        return reply.code(400).send({ error: message });
      }
    }
  );

  server.get<{ Params: WindowParams }>(
    "/:id",
    async (request: FastifyRequest<{ Params: WindowParams }>, reply: FastifyReply) => {
      const window = await alertWindowingService.getWindow(request.params.id);
      if (!window) return reply.code(404).send({ error: "Window not found" });
      return window;
    }
  );

  server.get<{ Querystring: ListQuery }>(
    "/",
    async (request: FastifyRequest<{ Querystring: ListQuery }>) => {
      const { assetCode, alertType, status, limit, offset } = request.query;
      return alertWindowingService.listWindows({
        assetCode,
        alertType,
        status,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });
    }
  );

  server.post<{ Params: WindowParams }>(
    "/:id/close",
    async (request: FastifyRequest<{ Params: WindowParams }>, reply: FastifyReply) => {
      const window = await alertWindowingService.closeWindow(request.params.id);
      if (!window) return reply.code(404).send({ error: "Window not found" });
      return window;
    }
  );

  server.get<{ Params: WindowParams }>(
    "/:id/summary",
    async (request: FastifyRequest<{ Params: WindowParams }>, reply: FastifyReply) => {
      const summary = await alertWindowingService.getSummary(request.params.id);
      if (!summary) return reply.code(404).send({ error: "Summary not found" });
      return summary;
    }
  );

  server.post(
    "/auto-close",
    async () => {
      const count = await alertWindowingService.autoCloseExpiredWindows();
      return { closedCount: count };
    }
  );
}
