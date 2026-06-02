import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getUsageMetricsService } from "../../services/usageMetrics.service.js";

export async function registerUsageMetrics(server: FastifyInstance) {
  const svc = getUsageMetricsService();

  server.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const duration = reply.elapsedTime ?? 0;
      const endpoint = request.routeOptions?.url || request.url;
      const method = request.method;
      const status = reply.statusCode;
      const userId = (request.headers["x-user-id"] as string) || null;

      void svc.record({ endpoint, method, status_code: status, duration_ms: Math.round(duration), user_id: userId, metadata: { path: request.url } });
    } catch (e) {
      // noop
    }
  });
}

export default registerUsageMetrics;
