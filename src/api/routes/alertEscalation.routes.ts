import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  alertEscalationService,
  type AlertSeverity,
  type EscalationTrigger,
} from "../../services/alertEscalation.service.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  getPaginationParams,
  formatPaginatedResponse,
} from "../../utils/pagination.js";

interface CreateEscalationRuleBody {
  assetCode: string;
  alertType: string;
  fromSeverity: AlertSeverity;
  toSeverity: AlertSeverity;
  triggerType: EscalationTrigger;
  frequencyThreshold?: number;
  durationMinutes?: number;
  recurrenceCount?: number;
  timeWindowMinutes: number;
  allowManualOverride?: boolean;
  notificationChannels?: string[];
}

interface RecordAlertOccurrenceBody {
  alertRuleId: string;
  assetCode: string;
  alertType: string;
  severity: AlertSeverity;
}

interface ManualOverrideBody {
  conditionHistoryId: string;
  overrideBy: string;
  reason: string;
  newSeverity?: AlertSeverity;
}

interface CloseConditionHistoryBody {
  conditionHistoryId: string;
}

export async function alertEscalationRoutes(server: FastifyInstance) {
  server.addHook("preHandler", authMiddleware());

  /**
   * Create an escalation rule
   * POST /alert-escalation/rules
   */
  server.post(
    "/alert-escalation/rules",
    {
      schema: {
        tags: ["Alert Escalation"],
        summary: "Create an alert escalation rule",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: [
            "assetCode",
            "alertType",
            "fromSeverity",
            "toSeverity",
            "triggerType",
            "timeWindowMinutes",
          ],
          properties: {
            assetCode: { type: "string", description: "Asset code (e.g., USDC)" },
            alertType: { type: "string", description: "Type of alert" },
            fromSeverity: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
            },
            toSeverity: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
            },
            triggerType: {
              type: "string",
              enum: ["frequency", "duration", "recurrence", "manual"],
              description: "How the escalation is triggered",
            },
            frequencyThreshold: {
              type: "number",
              description: "For frequency: how many occurrences trigger escalation",
            },
            durationMinutes: {
              type: "number",
              description:
                "For duration: how long (minutes) condition must persist",
            },
            recurrenceCount: {
              type: "number",
              description:
                "For recurrence: how many separate incidents within time window",
            },
            timeWindowMinutes: {
              type: "number",
              description: "Time window in minutes to track conditions",
            },
            allowManualOverride: {
              type: "boolean",
              default: true,
            },
            notificationChannels: {
              type: "array",
              items: { type: "string" },
              description:
                "Notification channels (email, telegram, discord, webhook)",
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              rule: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  assetCode: { type: "string" },
                  alertType: { type: "string" },
                  fromSeverity: { type: "string" },
                  toSeverity: { type: "string" },
                  triggerType: { type: "string" },
                  timeWindowMinutes: { type: "number" },
                },
              },
            },
          },
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      try {
        const body = request.body as CreateEscalationRuleBody;
        const rule = await alertEscalationService.createEscalationRule({
          assetCode: body.assetCode,
          alertType: body.alertType,
          fromSeverity: body.fromSeverity,
          toSeverity: body.toSeverity,
          triggerType: body.triggerType,
          frequencyThreshold: body.frequencyThreshold,
          durationMinutes: body.durationMinutes,
          recurrenceCount: body.recurrenceCount,
          timeWindowMinutes: body.timeWindowMinutes,
          allowManualOverride: body.allowManualOverride !== false,
          notificationChannels: body.notificationChannels || [],
          isActive: true,
        });

        return reply.status(201).send({ rule });
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : "Failed to create rule",
        });
      }
    }
  );

  /**
   * Record an alert occurrence
   * POST /alert-escalation/record
   */
  server.post(
    "/alert-escalation/record",
    {
      schema: {
        tags: ["Alert Escalation"],
        summary: "Record an alert occurrence for escalation tracking",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["alertRuleId", "assetCode", "alertType", "severity"],
          properties: {
            alertRuleId: { type: "string", description: "Alert rule ID" },
            assetCode: { type: "string", description: "Asset code" },
            alertType: { type: "string", description: "Alert type" },
            severity: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              conditionHistory: {
                type: "object",
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      try {
        const body = request.body as RecordAlertOccurrenceBody;
        const conditionHistory = await alertEscalationService.recordAlertOccurrence(
          body.alertRuleId,
          body.assetCode,
          body.alertType,
          body.severity
        );

        return reply.send({ conditionHistory });
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : "Failed to record alert",
        });
      }
    }
  );

  /**
   * Get escalation metrics
   * GET /alert-escalation/metrics
   */
  server.get(
    "/alert-escalation/metrics",
    {
      schema: {
        tags: ["Alert Escalation"],
        summary: "Get alert escalation metrics and statistics",
        security: [{ ApiKeyAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              metrics: {
                type: "object",
                properties: {
                  totalEscalations: { type: "number" },
                  escalationsBy24h: { type: "number" },
                  averageTimeToEscalate: { type: "number" },
                  escalationsByTrigger: { type: "object" },
                  escalationsBySeverity: { type: "object" },
                  activeConditions: { type: "number" },
                  manualOverrides: { type: "number" },
                },
              },
            },
          },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      try {
        const metrics = await alertEscalationService.getEscalationMetrics();
        return reply.send({ metrics });
      } catch (error) {
        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Failed to get metrics",
        });
      }
    }
  );

  /**
   * Apply manual override to an escalation
   * POST /alert-escalation/override
   */
  server.post(
    "/alert-escalation/override",
    {
      schema: {
        tags: ["Alert Escalation"],
        summary: "Apply manual override to alert escalation",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["conditionHistoryId", "overrideBy", "reason"],
          properties: {
            conditionHistoryId: {
              type: "string",
              description: "Condition history ID",
            },
            overrideBy: { type: "string", description: "User applying override" },
            reason: { type: "string", description: "Reason for override" },
            newSeverity: {
              type: "string",
              enum: ["low", "medium", "high", "critical"],
              description: "Optional new severity level",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { message: { type: "string" } },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      try {
        const body = request.body as ManualOverrideBody;
        await alertEscalationService.applyManualOverride(
          body.conditionHistoryId,
          body.overrideBy,
          body.reason,
          body.newSeverity
        );

        return reply.send({ message: "Manual override applied successfully" });
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : "Failed to apply override",
        });
      }
    }
  );

  /**
   * Close a condition history
   * POST /alert-escalation/close
   */
  server.post(
    "/alert-escalation/close",
    {
      schema: {
        tags: ["Alert Escalation"],
        summary: "Close/resolve a condition history entry",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["conditionHistoryId"],
          properties: {
            conditionHistoryId: {
              type: "string",
              description: "Condition history ID to close",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { message: { type: "string" } },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      try {
        const body = request.body as CloseConditionHistoryBody;
        await alertEscalationService.closeConditionHistory(body.conditionHistoryId);

        return reply.send({ message: "Condition history closed successfully" });
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : "Failed to close condition",
        });
      }
    }
  );
}
