import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "open" | "investigating" | "resolved";

export interface BridgeIncident {
  id: string;
  bridgeId: string;
  assetCode: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string;
  sourceUrl: string | null;
  followUpActions: string[];
  occurredAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentFilters {
  bridgeId?: string;
  assetCode?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  limit?: number;
  offset?: number;
}

export interface CreateIncidentPayload {
  bridgeId: string;
  assetCode?: string;
  severity: IncidentSeverity;
  title: string;
  description: string;
  sourceUrl?: string;
  followUpActions?: string[];
  occurredAt?: string;
}

export class IncidentService {
  private db = getDatabase();

  async listIncidents(filters: IncidentFilters = {}): Promise<{ incidents: BridgeIncident[]; total: number }> {
    const { bridgeId, assetCode, severity, status, limit = 50, offset = 0 } = filters;

    const baseQuery = this.db("bridge_incidents").where((qb) => {
      if (bridgeId) qb.where("bridge_id", bridgeId);
      if (assetCode) qb.where("asset_code", assetCode);
      if (severity) qb.where("severity", severity);
      if (status) qb.where("status", status);
    });

    const [{ count }] = await baseQuery.clone().count<[{ count: string }]>("id as count");
    const rows = await baseQuery
      .clone()
      .orderBy("occurred_at", "desc")
      .limit(limit)
      .offset(offset)
      .select("*");

    return { incidents: rows.map(this.mapRow), total: Number(count) };
  }

  async getIncident(id: string): Promise<BridgeIncident | null> {
    const row = await this.db("bridge_incidents").where("id", id).first();
    return row ? this.mapRow(row) : null;
  }

  async createIncident(payload: CreateIncidentPayload): Promise<BridgeIncident> {
    const [row] = await this.db("bridge_incidents")
      .insert({
        bridge_id: payload.bridgeId,
        asset_code: payload.assetCode ?? null,
        severity: payload.severity,
        title: payload.title,
        description: payload.description,
        source_url: payload.sourceUrl ?? null,
        follow_up_actions: JSON.stringify(payload.followUpActions ?? []),
        occurred_at: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
      })
      .returning("*");

    logger.info({ incidentId: row.id, bridgeId: payload.bridgeId }, "Bridge incident created");
    return this.mapRow(row);
  }

  async updateIncidentStatus(id: string, status: IncidentStatus): Promise<BridgeIncident | null> {
    const update: Record<string, unknown> = { status, updated_at: new Date() };
    if (status === "resolved") {
      update.resolved_at = new Date();
    }
    const [row] = await this.db("bridge_incidents").where("id", id).update(update).returning("*");
    if (!row) return null;
    logger.info({ incidentId: id, status }, "Bridge incident status updated");
    return this.mapRow(row);
  }

  async markRead(incidentId: string, userSession: string): Promise<void> {
    await this.db("bridge_incident_reads")
      .insert({ incident_id: incidentId, user_session: userSession })
      .onConflict(["incident_id", "user_session"])
      .ignore();
  }

  async getUnreadCount(userSession: string): Promise<number> {
    const [{ count }] = await this.db("bridge_incidents as i")
      .leftJoin("bridge_incident_reads as r", function () {
        this.on("r.incident_id", "=", "i.id").andOnVal("r.user_session", "=", userSession);
      })
      .whereNull("r.id")
      .count<[{ count: string }]>("i.id as count");
    return Number(count);
  }

  private mapRow(row: Record<string, unknown>): BridgeIncident {
    return {
      id: row.id as string,
      bridgeId: row.bridge_id as string,
      assetCode: (row.asset_code as string | null) ?? null,
      severity: row.severity as IncidentSeverity,
      status: row.status as IncidentStatus,
      title: row.title as string,
      description: row.description as string,
      sourceUrl: (row.source_url as string | null) ?? null,
      followUpActions: Array.isArray(row.follow_up_actions)
        ? (row.follow_up_actions as string[])
        : JSON.parse((row.follow_up_actions as string) || "[]"),
      occurredAt: row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : String(row.occurred_at),
      resolvedAt: row.resolved_at
        ? (row.resolved_at instanceof Date ? row.resolved_at.toISOString() : String(row.resolved_at))
        : null,
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
      updatedAt: row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
    };
  }
}
