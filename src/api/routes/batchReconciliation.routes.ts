import type { FastifyInstance } from "fastify";
import { runBatchReconciliation } from "../../jobs/batchReconciliation.job.js";
import { logger } from "../../utils/logger.js";

export async function batchReconciliationRoutes(server: FastifyInstance) {
  server.post(
    "/run",
    {
      schema: {
        tags: ["Reconciliation"],
        summary: "Trigger a batch reconciliation run across all supported assets",
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    },
    async (_request, reply) => {
      logger.info("Manual batch reconciliation run triggered via API");
      const report = await runBatchReconciliation();
      return reply.send(report);
    }
  );
}
