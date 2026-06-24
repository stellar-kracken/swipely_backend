import type { FastifyInstance } from "fastify";
import {
  sourceHealthScoringService,
  type SourceAlertState,
} from "../../services/sourceHealthScoring.service.js";

export async function sourceHealthScoringRoutes(server: FastifyInstance) {
  server.get(
    "/",
    {
      schema: {
        tags: ["Health"],
        summary: "List computed source health scores",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: { type: "string" },
            alertState: { type: "string", enum: ["ok", "warning", "critical"] },
            minScore: { type: "number", minimum: 0, maximum: 100 },
            maxScore: { type: "number", minimum: 0, maximum: 100 },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request) => {
      const q = request.query as {
        category?: string;
        alertState?: string;
        minScore?: number;
        maxScore?: number;
        limit?: number;
        offset?: number;
      };
      return sourceHealthScoringService.listScores({
        category: q.category,
        alertState: q.alertState as SourceAlertState | undefined,
        minScore: q.minScore,
        maxScore: q.maxScore,
        limit: q.limit ?? 100,
        offset: q.offset ?? 0,
      });
    },
  );

  server.post(
    "/compute",
    {
      schema: {
        tags: ["Health"],
        summary: "Compute and persist source health scores from recent check data",
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            windowHours: { type: "integer", minimum: 1, maximum: 168, default: 24 },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request) => {
      const body = (request.body ?? {}) as { windowHours?: number };
      const scores = await sourceHealthScoringService.computeAndStore(body.windowHours ?? 24);
      return { computed: scores.length, scores };
    },
  );

  server.get<{ Params: { sourceKey: string } }>(
    "/:sourceKey",
    {
      schema: {
        tags: ["Health"],
        summary: "Get current health score for a specific source",
        params: {
          type: "object",
          required: ["sourceKey"],
          properties: { sourceKey: { type: "string" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const score = await sourceHealthScoringService.getScore(request.params.sourceKey);
      if (!score) return reply.code(404).send({ error: "Source not found" });
      return { score };
    },
  );

  server.get<{
    Params: { sourceKey: string };
    Querystring: { limit?: number; since?: string };
  }>(
    "/:sourceKey/history",
    {
      schema: {
        tags: ["Health"],
        summary: "Get historical health score snapshots for a source",
        params: {
          type: "object",
          required: ["sourceKey"],
          properties: { sourceKey: { type: "string" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 1000, default: 200 },
            since: { type: "string", format: "date-time" },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const { sourceKey } = request.params;
      const { limit, since } = request.query;
      const sinceDate = since ? new Date(since) : undefined;
      if (sinceDate !== undefined && Number.isNaN(sinceDate.getTime())) {
        return reply.code(400).send({ error: "Invalid `since` date" });
      }
      const history = await sourceHealthScoringService.getHistory(sourceKey, {
        limit: limit ?? 200,
        since: sinceDate,
      });
      return { sourceKey, history, count: history.length };
    },
  );

  server.get<{ Params: { sourceKey: string } }>(
    "/:sourceKey/trend",
    {
      schema: {
        tags: ["Health"],
        summary: "Get 7-day trend analysis for a source health score",
        params: {
          type: "object",
          required: ["sourceKey"],
          properties: { sourceKey: { type: "string" } },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request) => {
      return sourceHealthScoringService.getTrend(request.params.sourceKey);
    },
  );
}
