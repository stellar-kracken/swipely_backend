import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ReconciliationService,
  type ReconciliationRange,
  type ReconciliationTriageStatus,
} from "../../services/reconciliation.service.js";
import { logger } from "../../utils/logger.js";

const listQuerySchema = z.object({
  assetCode: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const driftSummaryQuerySchema = z.object({
  assetCode: z.string().trim().min(1).optional(),
  bridge: z.string().trim().min(1).optional(),
  range: z.enum(["24h", "7d", "30d", "90d"]).optional(),
  startDate: z.string().trim().min(1).optional(),
  endDate: z.string().trim().min(1).optional(),
});

const mismatchDetailQuerySchema = z.object({
  range: z.enum(["24h", "7d", "30d", "90d"]).optional(),
});

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const triageBodySchema = z.object({
  status: z.enum(["open", "investigating", "acknowledged", "resolved", "false_positive"]),
  owner: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export async function reconciliationRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) {
  const svc = new ReconciliationService();

  fastify.get(
    "/drift-summaries",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = driftSummaryQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }

      try {
        return await svc.getDriftSummaries({
          assetCode: parsed.data.assetCode,
          bridge: parsed.data.bridge,
          range: parsed.data.range as ReconciliationRange | undefined,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
        });
      } catch (error) {
        logger.error({ error }, "Failed to fetch reconciliation drift summaries");
        return reply.code(500).send({ error: "Failed to fetch drift summaries" });
      }
    }
  );

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
    "/mismatches/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = idParamsSchema.safeParse(request.params ?? {});
      const query = mismatchDetailQuerySchema.safeParse(request.query ?? {});
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid mismatch id", details: params.error.flatten() });
      }
      if (!query.success) {
        return reply.code(400).send({ error: "Invalid query", details: query.error.flatten() });
      }

      try {
        const detail = await svc.getMismatchDetail(params.data.id, {
          range: query.data.range as ReconciliationRange | undefined,
        });
        if (!detail) return reply.code(404).send({ error: "Mismatch not found" });
        return detail;
      } catch (error) {
        logger.error({ error, id: params.data.id }, "Failed to fetch mismatch detail");
        return reply.code(500).send({ error: "Failed to fetch mismatch detail" });
      }
    }
  );

  fastify.patch(
    "/runs/:id/triage",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = idParamsSchema.safeParse(request.params ?? {});
      const body = triageBodySchema.safeParse(request.body ?? {});
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid run id", details: params.error.flatten() });
      }
      if (!body.success) {
        return reply.code(400).send({ error: "Invalid triage update", details: body.error.flatten() });
      }

      try {
        const triageUpdate = body.data as {
          status: ReconciliationTriageStatus;
          owner?: string | null;
          note?: string | null;
        };
        const run = await svc.updateTriageStatus(params.data.id, triageUpdate);
        if (!run) return reply.code(404).send({ error: "Run not found" });
        return { run };
      } catch (error) {
        logger.error({ error, id: params.data.id }, "Failed to update reconciliation triage");
        return reply.code(500).send({ error: "Failed to update triage status" });
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
