import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { auditRepository } from "./audit.repository.js";
import { auditReportService } from "./audit-report.service.js";
import { AuditQueryDto } from "./dto/audit-query.dto.js";
import { ExportReportDto } from "./dto/export-report.dto.js";

export function auditController(fastify: FastifyInstance, opts: any, done: () => void) {
  fastify.get("/", async (request: FastifyRequest<{ Querystring: AuditQueryDto }>, reply: FastifyReply) => {
    try {
      const events = await auditRepository.findEvents(request.query);
      return reply.send({ events });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Failed to fetch audit logs" });
    }
  });

  fastify.get("/export", async (request: FastifyRequest<{ Querystring: ExportReportDto }>, reply: FastifyReply) => {
    try {
      const { format, ...query } = request.query;
      
      if (format === "CSV") {
        const csv = await auditReportService.exportCsv(query);
        reply.header("Content-Type", "text/csv");
        reply.header("Content-Disposition", 'attachment; filename="audit_export.csv"');
        return reply.send(csv);
      } else if (format === "JSON") {
        const json = await auditReportService.exportJson(query);
        reply.header("Content-Type", "application/json");
        reply.header("Content-Disposition", 'attachment; filename="audit_export.json"');
        return reply.send(json);
      } else if (format === "PDF") {
        const pdf = await auditReportService.exportPdf(query);
        reply.header("Content-Type", "application/pdf");
        reply.header("Content-Disposition", 'attachment; filename="audit_export.pdf"');
        return reply.send(pdf);
      }
      
      return reply.status(400).send({ error: "Unsupported format" });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Failed to export audit logs" });
    }
  });

  done();
}
