import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ReconciliationService } from "../../services/reconciliation.service.js";
import { logger } from "../../utils/logger.js";

const listQuerySchema = z.object({
  assetCode: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export async function reconciliationRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) {
  const svc = new ReconciliationService();

  fastify.get(
    "/runs",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }

      try {
        const runs = await svc.listRuns({
          assetCode: parsed.data.assetCode,
          limit: parsed.data.limit,
        });
        return { runs };
      } catch (error) {
        logger.error({ error }, "Failed to list reconciliation runs");
        return reply.code(500).send({ error: "Failed to list reconciliation runs" });
      }
    }
  );

  fastify.get(
    "/latest/:assetCode",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { assetCode } = request.params as { assetCode: string };
      if (!assetCode) return reply.code(400).send({ error: "assetCode required" });

      try {
        const run = await svc.getLatestRun(assetCode);
        if (!run) return reply.code(404).send({ error: "No runs found" });
        return { run };
      } catch (error) {
        logger.error({ error, assetCode }, "Failed to fetch latest reconciliation run");
        return reply.code(500).send({ error: "Failed to fetch latest reconciliation run" });
      }
    }
  );
}

