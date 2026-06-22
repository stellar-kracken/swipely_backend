import { auditRepository } from "./audit.repository.js";
import { AuditQueryDto } from "./dto/audit-query.dto.js";
import { stringify } from "csv-stringify/sync";
import PDFDocument from "pdfkit";
import { AuditEvent } from "./audit.types.js";

export class AuditReportService {
  async exportCsv(query: AuditQueryDto): Promise<string> {
    const events = await auditRepository.findEvents(query);
    return stringify(events, {
      header: true,
      columns: [
        "id", "actorId", "actorType", "action", "resourceType", 
        "resourceId", "ipAddress", "createdAt", "checksum"
      ]
    });
  }

  async exportJson(query: AuditQueryDto): Promise<string> {
    const events = await auditRepository.findEvents(query);
    return JSON.stringify(events, null, 2);
  }

  async exportPdf(query: AuditQueryDto): Promise<Buffer> {
    const events = await auditRepository.findEvents(query);
    
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument();
        const chunks: Buffer[] = [];
        
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        
        doc.fontSize(16).text("Compliance Audit Report", { align: "center" });
        doc.moveDown();
        
        doc.fontSize(10);
        events.forEach(event => {
          doc.text(`[${new Date(event.createdAt).toISOString()}] ${event.action} by ${event.actorId} on ${event.resourceType}:${event.resourceId}`);
          doc.moveDown(0.5);
        });
        
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  async generateUserActivityReport(actorId: string): Promise<AuditEvent[]> {
    return auditRepository.findEvents({ actor: actorId });
  }

  async generateSecurityReport(): Promise<AuditEvent[]> {
    // Combine various security related actions
    const allEvents = await auditRepository.findEvents({});
    return allEvents.filter(e => e.action.includes('ROLE') || e.action.includes('MFA'));
  }
}

export const auditReportService = new AuditReportService();
