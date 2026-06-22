import { getDatabase } from "../database/connection.js";
import { AuditEvent } from "./audit.types.js";
import { AuditQueryDto } from "./dto/audit-query.dto.js";

export class AuditRepository {
  async getLatestChecksum(): Promise<string | null> {
    const db = getDatabase();
    const row = await db("audit_logs")
      .select("checksum")
      .orderBy("created_at", "desc")
      .first();
    
    return row ? row.checksum : null;
  }

  async insertEvent(event: AuditEvent): Promise<void> {
    const db = getDatabase();
    await db("audit_logs").insert({
      id: event.id,
      actor_id: event.actorId,
      actor_type: event.actorType,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId,
      ip_address: event.ipAddress || null,
      user_agent: event.userAgent || null,
      metadata: event.metadata ? JSON.stringify(event.metadata) : "{}",
      checksum: event.checksum,
      previous_checksum: event.previousChecksum || null,
      created_at: event.createdAt,
    });
  }

  async findEvents(query: AuditQueryDto): Promise<AuditEvent[]> {
    const db = getDatabase();
    let sqlQuery = db("audit_logs").select("*");

    if (query.from) {
      sqlQuery = sqlQuery.where("created_at", ">=", new Date(query.from));
    }
    if (query.to) {
      sqlQuery = sqlQuery.where("created_at", "<=", new Date(query.to));
    }
    if (query.actor) {
      sqlQuery = sqlQuery.where("actor_id", query.actor);
    }
    if (query.action) {
      sqlQuery = sqlQuery.where("action", query.action);
    }
    if (query.resource) {
      sqlQuery = sqlQuery.where("resource_type", query.resource);
    }

    const rows = await sqlQuery.orderBy("created_at", "desc");
    
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorType: row.actor_type,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      metadata: row.metadata,
      createdAt: row.created_at,
      checksum: row.checksum,
      previousChecksum: row.previous_checksum,
    }));
  }
}

export const auditRepository = new AuditRepository();
