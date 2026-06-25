import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  complianceReportGenerator,
  type ReportFilter,
  type ReportFormat,
  type ReportSection,
  type ReportType,
} from "../../services/complianceReportGenerator.service.js";
import { authMiddleware } from "../middleware/auth.js";

interface CreateReportTemplateBody {
  name: string;
  type: ReportType;
  description?: string;
  sections: ReportSection[];
  includes: {
    summary: boolean;
    charts: boolean;
    rawData: boolean;
    metrics: boolean;
    timeline: boolean;
    incidents: boolean;
  };
  filters?: ReportFilter[];
}

interface GenerateReportBody {
  templateId: string;
  format: ReportFormat;
  generatedBy: string;
  periodStart: string;
  periodEnd: string;
  filters?: ReportFilter[];
  includeSignature?: boolean;
  archiveAfter?: boolean;
}

export async function complianceReportRoutes(server: FastifyInstance) {
  server.addHook("preHandler", authMiddleware());

  /**
   * Create a report template
   * POST /compliance-reports/templates
   */
  server.post(
    "/compliance-reports/templates",
    {
      schema: {
        tags: ["Compliance Reports"],
        summary: "Create a new compliance report template",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["name", "type", "sections", "includes"],
          properties: {
            name: {
              type: "string",
              description: "Template name",
              example: "Monthly Bridge Activity Report",
            },
            type: {
              type: "string",
              enum: [
                "bridge_activity",
                "asset_health",
                "compliance_audit",
                "regulatory_filing",
                "incident_summary",
              ],
            },
            description: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  dataSource: { type: "string" },
                  fields: { type: "array", items: { type: "string" } },
                },
              },
            },
            includes: {
              type: "object",
              properties: {
                summary: { type: "boolean" },
                charts: { type: "boolean" },
                rawData: { type: "boolean" },
                metrics: { type: "boolean" },
                timeline: { type: "boolean" },
                incidents: { type: "boolean" },
              },
            },
            filters: {
              type: "array",
              items: { type: "object" },
              default: [],
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              template: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  type: { type: "string" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      try {
        const body = request.body as CreateReportTemplateBody;
        const template = await complianceReportGenerator.createTemplate({
          name: body.name,
          type: body.type,
          description: body.description || "",
          sections: body.sections,
          includes: body.includes,
          filters: body.filters || [],
          isActive: true,
        });

        return reply.status(201).send({ template });
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : "Failed to create template",
        });
      }
    }
  );

  /**
   * Generate a compliance report
   * POST /compliance-reports/generate
   */
  server.post(
    "/compliance-reports/generate",
    {
      schema: {
        tags: ["Compliance Reports"],
        summary: "Generate a compliance report from a template",
        security: [{ ApiKeyAuth: [] }],
        body: {
          type: "object",
          required: ["templateId", "format", "periodStart", "periodEnd", "generatedBy"],
          properties: {
            templateId: {
              type: "string",
              description: "Template ID to use for report generation",
            },
            format: {
              type: "string",
              enum: ["pdf", "csv", "json", "html"],
              description: "Output format for the report",
            },
            periodStart: {
              type: "string",
              format: "date-time",
              description: "Start date for report period",
            },
            periodEnd: {
              type: "string",
              format: "date-time",
              description: "End date for report period",
            },
            generatedBy: {
              type: "string",
              description: "User or system generating the report",
            },
            filters: {
              type: "array",
              items: { type: "object" },
              description: "Additional filters to apply to report data",
            },
            includeSignature: {
              type: "boolean",
              default: false,
              description: "Whether to digitally sign the report",
            },
            archiveAfter: {
              type: "boolean",
              default: false,
              description: "Whether to archive the report after generation",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              report: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  format: { type: "string" },
                  contentHash: { type: "string" },
                  metadata: { type: "object" },
                },
              },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      try {
        const body = request.body as GenerateReportBody;
        const report = await complianceReportGenerator.generateReport(
          body.templateId,
          body.format,
          {
            generatedBy: body.generatedBy,
            periodStart: new Date(body.periodStart),
            periodEnd: new Date(body.periodEnd),
            filters: body.filters,
            includeSignature: body.includeSignature,
            archiveAfter: body.archiveAfter,
          }
        );

        return reply.send({
          report: {
            id: report.id,
            title: report.title,
            type: report.type,
            format: report.format,
            generatedAt: report.generatedAt,
            periodStart: report.periodStart,
            periodEnd: report.periodEnd,
            contentHash: report.contentHash,
            signatureData: report.signatureData,
            metadata: report.metadata,
          },
        });
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : "Failed to generate report",
        });
      }
    }
  );

  /**
   * Archive a compliance report
   * POST /compliance-reports/:reportId/archive
   */
  server.post(
    "/compliance-reports/:reportId/archive",
    {
      schema: {
        tags: ["Compliance Reports"],
        summary: "Archive a compliance report for long-term storage",
        security: [{ ApiKeyAuth: [] }],
        params: {
          type: "object",
          required: ["reportId"],
          properties: {
            reportId: { type: "string", description: "Report ID to archive" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              archive: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  reportId: { type: "string" },
                  location: { type: "string" },
                  expiresAt: { type: "string" },
                },
              },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { reportId: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const archive = await complianceReportGenerator.archiveReport(
          request.params.reportId
        );

        return reply.send({
          archive: {
            id: archive.id,
            reportId: archive.reportId,
            archiveFormat: archive.archiveFormat,
            location: archive.location,
            size: archive.size,
            expiresAt: archive.expiresAt,
            archivedAt: archive.archivedAt,
          },
        });
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : "Failed to archive report",
        });
      }
    }
  );
}
