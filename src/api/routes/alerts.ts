import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { AlertService } from "../../services/alert.service.js";
import { validateRequest } from "../middleware/validation.js";
import {
  CreateAlertRuleSchema,
  UpdateAlertRuleSchema,
} from "../validations/alert.schema.js";

const CreateAlertRuleBodySchema = CreateAlertRuleSchema.extend({
  ownerAddress: z.string().min(1),
});

const UpdateAlertRuleBodySchema = UpdateAlertRuleSchema.extend({
  ownerAddress: z.string().min(1),
});

const SetActiveBodySchema = z.object({
  ownerAddress: z.string().min(1),
  isActive: z.boolean(),
});

const RuleIdParamsSchema = z.object({ ruleId: z.string().uuid() });
const AssetCodeParamsSchema = z.object({ assetCode: z.string().min(1).max(20) });

const LimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

type CreateBody = z.infer<typeof CreateAlertRuleBodySchema>;
type UpdateBody = z.infer<typeof UpdateAlertRuleBodySchema>;
type SetActiveBody = z.infer<typeof SetActiveBodySchema>;
type RuleIdParams = z.infer<typeof RuleIdParamsSchema>;
type AssetCodeParams = z.infer<typeof AssetCodeParamsSchema>;
type LimitQuery = z.infer<typeof LimitQuerySchema>;

export async function alertsRoutes(server: FastifyInstance) {
  const alertService = new AlertService();

  // GET /api/v1/alerts/rules - list rules for an owner
  server.get<{ Querystring: { owner: string } }>(
    "/rules",
    async (request: FastifyRequest<{ Querystring: { owner: string } }>, reply: FastifyReply) => {
      const { owner } = request.query;
      if (!owner) {
        return reply.status(400).send({ error: "owner query param required" });
      }
      const rules = await alertService.getRulesForOwner(owner);
      return {
        rules: rules.map((rule) => ({
          ...rule,
          owner_address: rule.ownerAddress,
        })),
      };
    }
  );

  // POST /api/v1/alerts/rules - create a rule
  server.post<{ Body: CreateBody }>(
    "/rules",
    {
      preHandler: validateRequest({ body: CreateAlertRuleBodySchema }),
    },
    async (request: FastifyRequest<{ Body: CreateBody }>, reply: FastifyReply) => {
      const {
        ownerAddress,
        name,
        assetCode,
        conditions,
        conditionOp,
        priority,
        cooldownSeconds,
        webhookUrl,
      } = request.body;

      const rule = await alertService.createRule(
        ownerAddress,
        name,
        assetCode,
        conditions as any,
        conditionOp as any,
        priority as any,
        cooldownSeconds,
        webhookUrl
      );

      return reply.status(201).send({ rule });
    }
  );

  // GET /api/v1/alerts/rules/:ruleId
  server.get<{ Params: RuleIdParams }>(
    "/rules/:ruleId",
    {
      preHandler: validateRequest({ params: RuleIdParamsSchema }),
    },
    async (request: FastifyRequest<{ Params: RuleIdParams }>, reply: FastifyReply) => {
      const rule = await alertService.getRule(request.params.ruleId);
      if (!rule) return reply.status(404).send({ error: "Rule not found" });
      return { rule };
    }
  );

  // PATCH /api/v1/alerts/rules/:ruleId
  server.patch<{ Params: RuleIdParams; Body: UpdateBody }>(
    "/rules/:ruleId",
    {
      preHandler: validateRequest({
        params: RuleIdParamsSchema,
        body: UpdateAlertRuleBodySchema,
      }),
    },
    async (request: FastifyRequest<{ Params: RuleIdParams; Body: UpdateBody }>, reply: FastifyReply) => {
      const { ruleId } = request.params;
      const { ownerAddress, ...updates } = request.body;
      const rule = await alertService.updateRule(ruleId, ownerAddress, updates as any);
      if (!rule) return reply.status(404).send({ error: "Rule not found" });
      return { rule };
    }
  );

  // PATCH /api/v1/alerts/rules/:ruleId/active
  server.patch<{ Params: RuleIdParams; Body: SetActiveBody }>(
    "/rules/:ruleId/active",
    {
      preHandler: validateRequest({
        params: RuleIdParamsSchema,
        body: SetActiveBodySchema,
      }),
    },
    async (request: FastifyRequest<{ Params: RuleIdParams; Body: SetActiveBody }>, reply: FastifyReply) => {
      const { ruleId } = request.params;
      const { ownerAddress, isActive } = request.body;
      const ok = await alertService.setRuleActive(ruleId, ownerAddress, isActive);
      if (!ok) return reply.status(404).send({ error: "Rule not found" });
      return { success: true };
    }
  );

  // GET /api/v1/alerts/history/:assetCode
  server.get<{ Params: AssetCodeParams; Querystring: LimitQuery }>(
    "/history/:assetCode",
    {
      preHandler: validateRequest({
        params: AssetCodeParamsSchema,
        query: LimitQuerySchema,
      }),
    },
    async (request: FastifyRequest<{ Params: AssetCodeParams; Querystring: LimitQuery }>, _reply: FastifyReply) => {
      const { assetCode } = request.params;
      const { limit } = request.query;
      const events = await alertService.getAlertHistory(assetCode, limit ?? 50);
      return { events };
    }
  );

  // GET /api/v1/alerts/recent
  server.get<{ Querystring: LimitQuery }>(
    "/recent",
    {
      preHandler: validateRequest({ query: LimitQuerySchema }),
    },
    async (request: FastifyRequest<{ Querystring: LimitQuery }>, _reply: FastifyReply) => {
      const { limit } = request.query;
      const events = await alertService.getRecentAlerts(limit ?? 100);
      return { events };
    }
  );

  // GET /api/v1/alerts/rules/:ruleId/events
  server.get<{ Params: RuleIdParams; Querystring: LimitQuery }>(
    "/rules/:ruleId/events",
    {
      preHandler: validateRequest({
        params: RuleIdParamsSchema,
        query: LimitQuerySchema,
      }),
    },
    async (request: FastifyRequest<{ Params: RuleIdParams; Querystring: LimitQuery }>, _reply: FastifyReply) => {
      const { ruleId } = request.params;
      const { limit } = request.query;
      const events = await alertService.getAlertsForRule(ruleId, limit ?? 50);
      return { events };
    }
  );
}
