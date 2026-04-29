import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { schemaDriftService } from "../../services/schemaDrift.service.js";
import { createChildLogger } from "../../utils/logger.js";

const logger = createChildLogger("api:schema-drift");

export default async function schemaDriftRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/schema-drift/report
   * Returns a summary of all detected schema drifts.
   */
  fastify.get(
    "/report",
    {
      schema: {
        description: "Get schema drift report",
        tags: ["Schema Drift"],
        response: {
          200: {
            type: "object",
            properties: {
              summary: { type: "array" },
              recentIncidents: { type: "array" },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const report = await schemaDriftService.getDriftReport();
        return reply.send(report);
      } catch (err) {
        logger.error({ err }, "Failed to fetch schema drift report");
        return reply.status(500).send({ error: "Failed to fetch schema drift report" });
      }
    }
  );

  /**
   * POST /api/schema-drift/resolve/:id
   * Marks a drift incident as resolved.
   */
  fastify.post(
    "/resolve/:id",
    {
      schema: {
        description: "Mark a schema drift incident as resolved",
        tags: ["Schema Drift"],
        params: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      try {
        // Direct DB update for simplicity in this example
        const { getDatabase } = await import("../../database/connection.js");
        const db = getDatabase();
        const updated = await db("schema_drift_incidents")
          .where({ id })
          .update({ is_resolved: true, updated_at: db.fn.now() });

        if (updated === 0) {
          return reply.status(404).send({ error: "Incident not found" });
        }

        return reply.send({ success: true });
      } catch (err) {
        logger.error({ err, id }, "Failed to resolve schema drift incident");
        return reply.status(500).send({ error: "Failed to resolve schema drift incident" });
      }
    }
  );

  /**
   * POST /api/schema-drift/baseline/:sourceName
   * Manually updates the baseline for a source.
   */
  fastify.post(
    "/baseline/:sourceName",
    {
      schema: {
        description: "Manually update the baseline schema for a source",
        tags: ["Schema Drift"],
        params: {
          type: "object",
          properties: {
            sourceName: { type: "string" },
          },
        },
        body: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
    async (request: FastifyRequest<{ Params: { sourceName: string }; Body: any }>, reply: FastifyReply) => {
      const { sourceName } = request.params;
      const payload = request.body;
      
      try {
        // We use the payload to generate the new baseline
        const (schemaDriftService as any).saveBaseline(sourceName, (schemaDriftService as any).extractSchema(payload));
        return reply.send({ success: true, message: `Baseline updated for ${sourceName}` });
      } catch (err) {
        logger.error({ err, sourceName }, "Failed to update baseline schema");
        return reply.status(500).send({ error: "Failed to update baseline schema" });
      }
    }
  );
}
