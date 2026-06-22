/**
 * Event Federation HTTP routes.
 *
 * GET /api/v1/event-federation/health
 *   Returns a full FederationHealth snapshot.
 *
 * GET /api/v1/event-federation/replay
 *   Query-string: chain?, since?, fromBlock?, limit?
 *   Returns up to `limit` buffered FederatedEvents matching the filters.
 *
 * GET /api/v1/event-federation/sources
 *   Returns per-source liveness data.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getEventFederationService } from "../../services/eventFederation/index.js";

export async function eventFederationRoutes(server: FastifyInstance) {
  // ─── Health ────────────────────────────────────────────────────────────────

  server.get(
    "/health",
    {
      schema: {
        tags: ["Event Federation"],
        summary: "Federation health snapshot",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["healthy", "degraded", "offline"] },
              sources: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    chain: { type: "string" },
                    status: { type: "string" },
                    lastEventAt: { type: ["string", "null"] },
                    gapMs: { type: ["number", "null"] },
                    eventsReceived: { type: "number" },
                    errorsCount: { type: "number" },
                    reconnectCount: { type: "number" },
                  },
                },
              },
              totalEventsProcessed: { type: "number" },
              dedupRejectedCount: { type: "number" },
              replayBufferSize: { type: "number" },
              uptimeMs: { type: "number" },
              checkedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return getEventFederationService().health();
    },
  );

  // ─── Sources ───────────────────────────────────────────────────────────────

  server.get(
    "/sources",
    {
      schema: {
        tags: ["Event Federation"],
        summary: "Per-source liveness",
        response: {
          200: {
            type: "object",
            properties: {
              sources: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: true,
                },
              },
              checkedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const health = getEventFederationService().health();
      return { sources: health.sources, checkedAt: health.checkedAt };
    },
  );

  // ─── Replay ────────────────────────────────────────────────────────────────

  server.get(
    "/replay",
    {
      schema: {
        tags: ["Event Federation"],
        summary: "Catch-up replay of recent federated events",
        querystring: {
          type: "object",
          properties: {
            chain: { type: "string" },
            since: { type: "string", format: "date-time" },
            fromBlock: { type: "number" },
            limit: { type: "number", minimum: 1, maximum: 1000, default: 200 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              events: {
                type: "array",
                items: { type: "object", additionalProperties: true },
              },
              count: { type: "number" },
              cursor: { type: ["string", "null"] },
              timestamp: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: {
          chain?: string;
          since?: string;
          fromBlock?: number;
          limit?: number;
        };
      }>,
      _reply: FastifyReply,
    ) => {
      const { chain, since, fromBlock, limit = 200 } = request.query;
      const events = getEventFederationService().replay({
        chain,
        since,
        fromBlock,
        limit,
      });

      const cursor =
        events.length > 0 ? events[events.length - 1].sourceId : null;

      return {
        events,
        count: events.length,
        cursor,
        timestamp: new Date().toISOString(),
      };
    },
  );
}
