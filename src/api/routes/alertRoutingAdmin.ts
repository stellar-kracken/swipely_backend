import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { alertRoutingService } from "../../services/alertRouting.service.js";
import type { RoutingSeverity } from "../../services/alertRouting.service.js";
import {
  createAlertRoutingRuleSchema,
  listAlertRoutingAuditQuerySchema,
  listAlertRoutingRulesQuerySchema,
  updateAlertRoutingRuleSchema,
} from "../validations/alertRouting.schema.js";

const VALID_SEVERITIES = new Set<string>(["critical", "high", "medium", "low"]);

function parseSeverity(value: string): RoutingSeverity {
  if (VALID_SEVERITIES.has(value)) return value as RoutingSeverity;
  return "medium";
}

export async function alertRoutingAdminRoutes(server: FastifyInstance) {
  const requireAdmin = authMiddleware({ requiredScopes: ["admin:api-keys"] });

  server.get<{ Querystring: { ownerAddress?: string } }>(
    "/rules",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "List alert routing rules",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            ownerAddress: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = listAlertRoutingRulesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const rules = await alertRoutingService.listRules(parsed.data.ownerAddress);
      return { rules };
    }
  );

  server.post(
    "/rules",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Create an alert routing rule",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["name", "channels"],
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            ownerAddress: { type: "string" },
            severityLevels: {
              type: "array",
              items: { type: "string", enum: ["critical", "high", "medium", "low"] },
            },
            assetCodes: { type: "array", items: { type: "string" } },
            sourceTypes: { type: "array", items: { type: "string" } },
            channels: {
              type: "array",
              items: { type: "string", enum: ["in_app", "webhook", "email"] },
            },
            fallbackChannels: {
              type: "array",
              items: { type: "string", enum: ["in_app", "webhook", "email"] },
            },
            suppressionWindowSeconds: { type: "integer" },
            priorityOrder: { type: "integer" },
            isActive: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = createAlertRoutingRuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const rule = await alertRoutingService.createRule({
        ...(parsed.data as any),
        createdBy: request.apiKeyAuth?.name ?? "admin",
      });
      return reply.code(201).send({ rule });
    }
  );

  server.patch<{ Params: { id: string } }>(
    "/rules/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Update an alert routing rule",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            ownerAddress: { type: "string" },
            severityLevels: {
              type: "array",
              items: { type: "string", enum: ["critical", "high", "medium", "low"] },
            },
            assetCodes: { type: "array", items: { type: "string" } },
            sourceTypes: { type: "array", items: { type: "string" } },
            channels: {
              type: "array",
              items: { type: "string", enum: ["in_app", "webhook", "email"] },
            },
            fallbackChannels: {
              type: "array",
              items: { type: "string", enum: ["in_app", "webhook", "email"] },
            },
            suppressionWindowSeconds: { type: "integer" },
            priorityOrder: { type: "integer" },
            isActive: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = updateAlertRoutingRuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const rule = await alertRoutingService.updateRule(request.params.id, parsed.data);
      if (!rule) {
        return reply.code(404).send({ error: "Routing rule not found" });
      }
      return { rule };
    }
  );

  server.delete<{ Params: { id: string } }>(
    "/rules/:id",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Delete an alert routing rule",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const deleted = await alertRoutingService.deleteRule(request.params.id);
      if (!deleted) {
        return reply.code(404).send({ error: "Routing rule not found" });
      }
      return reply.code(204).send();
    }
  );

  server.get<{
    Querystring: {
      ownerAddress?: string;
      status?: "queued" | "delivered" | "suppressed" | "failed" | "fallback";
      channel?: string;
      limit?: number;
    };
  }>(
    "/audit",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Get alert routing audit history",
        security: [{ ApiKeyAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            ownerAddress: { type: "string" },
            status: {
              type: "string",
              enum: ["queued", "delivered", "suppressed", "failed", "fallback"],
            },
            channel: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = listAlertRoutingAuditQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const entries = await alertRoutingService.getAuditHistory(parsed.data);
      return { entries };
    }
  );

  server.post(
    "/simulate",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["Config"],
        summary: "Dry-run alert routing simulation (no dispatches)",
        description:
          "Evaluates which active routing rules would match a simulated alert and which channels would fire, without dispatching anything to real endpoints.",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["severity"],
          additionalProperties: false,
          properties: {
            severity: {
              type: "string",
              enum: ["critical", "high", "medium", "low"],
            },
            assetCode: { type: "string", maxLength: 20 },
            sourceType: { type: "string", maxLength: 80 },
            ownerAddress: { type: "string" },
            label: { type: "string", maxLength: 120 },
            triggeredValue: { type: "number" },
            threshold: { type: "number" },
            metric: { type: "string", maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        severity: string;
        assetCode?: string;
        sourceType?: string;
        ownerAddress?: string;
        label?: string;
        triggeredValue?: number;
        threshold?: number;
        metric?: string;
      };

      if (!VALID_SEVERITIES.has(body.severity)) {
        return reply.code(400).send({ error: "Invalid severity value" });
      }

      const severity = parseSeverity(body.severity);
      const assetCode = (body.assetCode ?? "").trim().toUpperCase();
      const sourceType = (body.sourceType ?? "").trim();

      // Load rules — scope by ownerAddress if provided
      const allRules = await alertRoutingService.listRules(body.ownerAddress);
      const activeRules = allRules.filter((rule) => rule.isActive);
      const inactiveRules = allRules.filter((rule) => !rule.isActive);

      // Evaluate each active rule in priority order
      const ruleResults = activeRules
        .slice()
        .sort((a, b) => a.priorityOrder - b.priorityOrder)
        .map((rule) => {
          const severityMatch =
            rule.severityLevels.length === 0 ||
            rule.severityLevels.includes(severity);

          const assetMatch =
            rule.assetCodes.length === 0 ||
            (assetCode !== "" &&
              rule.assetCodes
                .map((c) => c.toUpperCase())
                .includes(assetCode));

          const sourceMatch =
            rule.sourceTypes.length === 0 ||
            (sourceType !== "" && rule.sourceTypes.includes(sourceType));

          const matched = severityMatch && assetMatch && sourceMatch;

          const reasons: string[] = [];

          if (rule.severityLevels.length === 0) {
            reasons.push("Severity: matches any (no filter set)");
          } else if (severityMatch) {
            reasons.push(
              `Severity: "${severity}" is in [${rule.severityLevels.join(", ")}]`
            );
          } else {
            reasons.push(
              `Severity: "${severity}" not in [${rule.severityLevels.join(", ")}] — no match`
            );
          }

          if (rule.assetCodes.length === 0) {
            reasons.push("Asset: matches any (no filter set)");
          } else if (assetMatch) {
            reasons.push(
              `Asset: "${assetCode}" is in [${rule.assetCodes.join(", ")}]`
            );
          } else {
            reasons.push(
              `Asset: "${assetCode || "(empty)"}" not in [${rule.assetCodes.join(", ")}] — no match`
            );
          }

          if (rule.sourceTypes.length === 0) {
            reasons.push("Source type: matches any (no filter set)");
          } else if (sourceMatch) {
            reasons.push(
              `Source type: "${sourceType}" is in [${rule.sourceTypes.join(", ")}]`
            );
          } else {
            reasons.push(
              `Source type: "${sourceType || "(empty)"}" not in [${rule.sourceTypes.join(", ")}] — no match`
            );
          }

          return {
            ruleId: rule.id,
            ruleName: rule.name,
            priorityOrder: rule.priorityOrder,
            ownerAddress: rule.ownerAddress,
            matched,
            reasons,
            channels: matched ? rule.channels : [],
            fallbackChannels: matched ? rule.fallbackChannels : [],
            suppressionWindowSeconds: rule.suppressionWindowSeconds,
          };
        });

      const matchedResults = ruleResults.filter((r) => r.matched);
      const firstMatch = matchedResults[0] ?? null;

      const simulationId = `sim_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      return reply.send({
        simulationId,
        timestamp: new Date().toISOString(),
        input: {
          severity,
          assetCode,
          sourceType,
          ownerAddress: body.ownerAddress ?? null,
          label: body.label ?? null,
          triggeredValue: body.triggeredValue ?? null,
          threshold: body.threshold ?? null,
          metric: body.metric ?? null,
        },
        results: ruleResults,
        skippedInactive: inactiveRules.map((r) => ({
          ruleId: r.id,
          ruleName: r.name,
          priorityOrder: r.priorityOrder,
        })),
        summary: {
          totalActiveRules: activeRules.length,
          totalMatched: matchedResults.length,
          firstMatchingRule: firstMatch
            ? { ruleId: firstMatch.ruleId, ruleName: firstMatch.ruleName }
            : null,
          wouldDispatch: firstMatch !== null,
          effectiveChannels: firstMatch?.channels ?? [],
          effectiveFallbackChannels: firstMatch?.fallbackChannels ?? [],
          suppressionWindowSeconds: firstMatch?.suppressionWindowSeconds ?? 0,
        },
      });
    }
  );
}
