import type { FastifyInstance } from "fastify";
import {
  exportService,
  ExportFormat,
  ExportFilters,
} from "../../services/export.service";

export async function exportRoutes(server: FastifyInstance) {
  // Create export
  server.post<{
    Body: {
      userId: string;
      exportType: string;
      format: ExportFormat;
      filters: ExportFilters;
      fields: string[];
    };
  }>("/", async (request, reply) => {
    const { userId, exportType, format, filters, fields } = request.body;

    const exportRequest = await exportService.createExport(
      userId,
      exportType,
      format,
      filters,
      fields,
    );

    return reply.code(201).send(exportRequest);
  });

  // Get export status
  server.get<{ Params: { exportId: string } }>(
    "/:exportId",
    async (request, reply) => {
      const { exportId } = request.params;
      const exportRequest = await exportService.getExport(exportId);

      if (!exportRequest) {
        return reply.code(404).send({ error: "Export not found" });
      }

      return exportRequest;
    },
  );

  // Download export
  server.get<{ Params: { exportId: string } }>(
    "/download/:exportId",
    async (request, reply) => {
      const { exportId } = request.params;
      const exportRequest = await exportService.getExport(exportId);

      if (!exportRequest) {
        return reply.code(404).send({ error: "Export not found" });
      }

      if (exportRequest.status !== "completed") {
        return reply.code(400).send({ error: "Export not ready" });
      }

      const content = await exportService.getDownloadContent(exportId);

      if (!content) {
        return reply
          .code(404)
          .send({ error: "Export file not found or expired" });
      }

      // Set appropriate headers
      const extension =
        exportRequest.format === "excel" ? "xlsx" : exportRequest.format;
      reply.header("Content-Type", `application/${exportRequest.format}`);
      reply.header(
        "Content-Disposition",
        `attachment; filename="export-${exportId}.${extension}"`,
      );

      return content;
    },
  );

  // Get export history
  server.get<{
    Querystring: { userId: string; limit?: number };
  }>("/history", async (request, _reply) => {
    const { userId, limit } = request.query;
    const history = await exportService.getExportHistory(userId, limit);
    return { history, total: history.length };
  });

  // Create export template
  server.post<{
    Body: {
      name: string;
      description: string;
      exportType: string;
      defaultFormat: ExportFormat;
      defaultFields: string[];
      defaultFilters: ExportFilters;
      createdBy: string;
    };
  }>("/templates", async (request, reply) => {
    const template = await exportService.createTemplate({
      name: request.body.name,
      description: request.body.description,
      export_type: request.body.exportType,
      default_format: request.body.defaultFormat,
      default_fields: request.body.defaultFields,
      default_filters: request.body.defaultFilters,
      created_by: request.body.createdBy,
    });

    return reply.code(201).send(template);
  });

  // Get export templates
  server.get("/templates", async (_request, _reply) => {
    const templates = await exportService.getTemplates();
    return { templates, total: templates.length };
  });

  // Cleanup expired exports
  server.post("/cleanup", async (_request, reply) => {
    await exportService.cleanupExpiredExports();
    return reply.code(200).send({ message: "Cleanup completed" });
  });
}
