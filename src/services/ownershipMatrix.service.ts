import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { auditService } from "./audit.service.js";
import { stringify } from "csv-stringify/sync";

export type OwnerType = "user" | "team";

export interface AlertOwnership {
  id: string;
  alertId: string;
  ownerType: OwnerType;
  ownerId: string;
  createdBy: string;
  createdAt: Date;
}

export interface EscalationContact {
  id: string;
  alertId: string;
  contactUserId: string;
  order: number;
  createdBy: string;
  createdAt: Date;
}

export interface OwnershipMatrixEntry {
  alertId: string;
  alertName: string;
  ownerType: OwnerType;
  ownerId: string;
  createdBy: string;
  createdAt: Date;
  escalationContacts: Array<{
    contactUserId: string;
    order: number;
  }>;
}

export interface OwnershipMatrixFilters {
  teamId?: string;
  ownerId?: string;
  alertId?: string;
  groupBy?: "team" | "none";
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedOwnershipMatrix {
  data: OwnershipMatrixEntry[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface GroupedOwnershipMatrix {
  teams: Array<{
    teamId: string;
    alerts: OwnershipMatrixEntry[];
  }>;
}

export class OwnershipMatrixService {
  /**
   * Assign or transfer ownership of an alert
   */
  async assignOwner(
    alertId: string,
    ownerId: string,
    ownerType: OwnerType,
    actorId: string
  ): Promise<AlertOwnership> {
    const db = getDatabase();

    // Validate alert exists
    const alert = await db("alert_rules").where({ id: alertId }).first();
    if (!alert) {
      throw new Error("Alert not found");
    }

    return db.transaction(async (trx) => {
      // Check if ownership already exists
      const existing = await trx("alert_ownership")
        .where({ alert_id: alertId })
        .first();

      let ownership: AlertOwnership;
      let auditAction: string;
      let auditBefore: Record<string, unknown> | null = null;

      if (existing) {
        // Transfer ownership
        auditAction = "alert.ownership_transferred";
        auditBefore = {
          ownerType: existing.owner_type,
          ownerId: existing.owner_id,
        };

        const [updated] = await trx("alert_ownership")
          .where({ alert_id: alertId })
          .update({
            owner_type: ownerType,
            owner_id: ownerId,
            created_by: actorId,
            created_at: trx.fn.now(),
          })
          .returning("*");

        ownership = this.mapOwnership(updated);
      } else {
        // Assign new ownership
        auditAction = "alert.ownership_assigned";

        const [created] = await trx("alert_ownership")
          .insert({
            alert_id: alertId,
            owner_type: ownerType,
            owner_id: ownerId,
            created_by: actorId,
          })
          .returning("*");

        ownership = this.mapOwnership(created);
      }

      // Write audit log
      await auditService.log({
        action: auditAction as any,
        actorId,
        actorType: "user",
        resourceType: "alert_ownership",
        resourceId: alertId,
        before: auditBefore,
        after: {
          ownerType,
          ownerId,
        },
        metadata: {
          alertName: alert.name,
        },
        severity: "info",
      });

      logger.info(
        { alertId, ownerId, ownerType, actorId, action: auditAction },
        "Alert ownership updated"
      );

      return ownership;
    });
  }

  /**
   * Get current owner of an alert
   */
  async getOwner(alertId: string): Promise<AlertOwnership | null> {
    const db = getDatabase();
    const row = await db("alert_ownership").where({ alert_id: alertId }).first();
    return row ? this.mapOwnership(row) : null;
  }

  /**
   * Get ownership matrix with filters and pagination
   */
  async getOwnershipMatrix(
    filters: OwnershipMatrixFilters = {},
    pagination: PaginationParams = { page: 1, limit: 50 }
  ): Promise<PaginatedOwnershipMatrix | GroupedOwnershipMatrix> {
    const db = getDatabase();
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    // Build base query
    let query = db("alert_ownership")
      .join("alert_rules", "alert_ownership.alert_id", "alert_rules.id")
      .select(
        "alert_ownership.alert_id",
        "alert_rules.name as alert_name",
        "alert_ownership.owner_type",
        "alert_ownership.owner_id",
        "alert_ownership.created_by",
        "alert_ownership.created_at"
      );

    let countQuery = db("alert_ownership").join(
      "alert_rules",
      "alert_ownership.alert_id",
      "alert_rules.id"
    );

    // Apply filters
    if (filters.alertId) {
      query = query.where("alert_ownership.alert_id", filters.alertId);
      countQuery = countQuery.where("alert_ownership.alert_id", filters.alertId);
    }
    if (filters.ownerId) {
      query = query.where("alert_ownership.owner_id", filters.ownerId);
      countQuery = countQuery.where("alert_ownership.owner_id", filters.ownerId);
    }
    if (filters.teamId) {
      query = query
        .where("alert_ownership.owner_type", "team")
        .where("alert_ownership.owner_id", filters.teamId);
      countQuery = countQuery
        .where("alert_ownership.owner_type", "team")
        .where("alert_ownership.owner_id", filters.teamId);
    }

    // Handle grouping
    if (filters.groupBy === "team") {
      return this.getGroupedByTeam(query);
    }

    // Paginated query
    query = query.orderBy("alert_ownership.created_at", "desc").limit(limit).offset(offset);

    const [rows, countResult] = await Promise.all([
      query,
      countQuery.count("* as count").first(),
    ]);

    const total = Number(countResult?.count ?? 0);

    // Fetch escalation contacts for all alerts in result
    const alertIds = rows.map((r: any) => r.alert_id);
    const escalationContacts = alertIds.length > 0
      ? await db("escalation_contacts")
          .whereIn("alert_id", alertIds)
          .orderBy("order", "asc")
      : [];

    // Map to response format
    const data: OwnershipMatrixEntry[] = rows.map((row: any) => ({
      alertId: row.alert_id,
      alertName: row.alert_name,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      escalationContacts: escalationContacts
        .filter((ec: any) => ec.alert_id === row.alert_id)
        .map((ec: any) => ({
          contactUserId: ec.contact_user_id,
          order: ec.order,
        })),
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Add escalation contact for an alert
   */
  async addEscalationContact(
    alertId: string,
    contactUserId: string,
    order: number,
    actorId: string
  ): Promise<EscalationContact> {
    const db = getDatabase();

    // Validate alert exists
    const alert = await db("alert_rules").where({ id: alertId }).first();
    if (!alert) {
      throw new Error("Alert not found");
    }

    return db.transaction(async (trx) => {
      // Check if contact already exists for this alert
      const existing = await trx("escalation_contacts")
        .where({ alert_id: alertId, contact_user_id: contactUserId })
        .first();

      if (existing) {
        throw new Error("Contact already exists for this alert");
      }

      const [created] = await trx("escalation_contacts")
        .insert({
          alert_id: alertId,
          contact_user_id: contactUserId,
          order,
          created_by: actorId,
        })
        .returning("*");

      // Write audit log
      await auditService.log({
        action: "alert.escalation_added" as any,
        actorId,
        actorType: "user",
        resourceType: "escalation_contact",
        resourceId: alertId,
        after: {
          contactUserId,
          order,
        },
        metadata: {
          alertName: alert.name,
        },
        severity: "info",
      });

      logger.info(
        { alertId, contactUserId, order, actorId },
        "Escalation contact added"
      );

      return this.mapEscalationContact(created);
    });
  }

  /**
   * Get escalation contacts for an alert
   */
  async getEscalationContacts(alertId: string): Promise<EscalationContact[]> {
    const db = getDatabase();
    const rows = await db("escalation_contacts")
      .where({ alert_id: alertId })
      .orderBy("order", "asc");
    return rows.map(this.mapEscalationContact);
  }

  /**
   * Remove escalation contact
   */
  async removeEscalationContact(
    alertId: string,
    contactUserId: string,
    actorId: string
  ): Promise<boolean> {
    const db = getDatabase();

    return db.transaction(async (trx) => {
      const existing = await trx("escalation_contacts")
        .where({ alert_id: alertId, contact_user_id: contactUserId })
        .first();

      if (!existing) {
        return false;
      }

      const alert = await trx("alert_rules").where({ id: alertId }).first();

      await trx("escalation_contacts")
        .where({ alert_id: alertId, contact_user_id: contactUserId })
        .delete();

      // Write audit log
      await auditService.log({
        action: "alert.escalation_removed" as any,
        actorId,
        actorType: "user",
        resourceType: "escalation_contact",
        resourceId: alertId,
        before: {
          contactUserId,
          order: existing.order,
        },
        metadata: {
          alertName: alert?.name,
        },
        severity: "info",
      });

      logger.info({ alertId, contactUserId, actorId }, "Escalation contact removed");

      return true;
    });
  }

  /**
   * Get audit history for an alert's ownership
   */
  async getAuditHistory(
    alertId: string,
    pagination: PaginationParams = { page: 1, limit: 50 }
  ): Promise<{
    entries: Array<{
      id: string;
      action: string;
      actorId: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      metadata: Record<string, unknown>;
      createdAt: Date;
    }>;
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  }> {
    const { page, limit } = pagination;
    const result = await auditService.query({
      resourceId: alertId,
      limit,
      offset: (page - 1) * limit,
    });

    // Filter to ownership-related actions
    const ownershipActions = [
      "alert.ownership_assigned",
      "alert.ownership_transferred",
      "alert.escalation_added",
      "alert.escalation_removed",
    ];

    const filtered = result.entries.filter((e) =>
      ownershipActions.includes(e.action)
    );

    return {
      entries: filtered.map((e) => ({
        id: e.id,
        action: e.action,
        actorId: e.actorId,
        before: e.before,
        after: e.after,
        metadata: e.metadata,
        createdAt: e.createdAt,
      })),
      meta: {
        total: filtered.length,
        page,
        limit,
        totalPages: Math.ceil(filtered.length / limit),
      },
    };
  }

  /**
   * Export ownership matrix
   */
  async exportOwnershipMatrix(
    format: "csv" | "json",
    filters: OwnershipMatrixFilters = {}
  ): Promise<string> {
    // Get all data without pagination
    const result = await this.getOwnershipMatrix(filters, { page: 1, limit: 10000 });

    if ("teams" in result) {
      throw new Error("Export does not support grouped results");
    }

    if (format === "json") {
      return JSON.stringify(result.data, null, 2);
    }

    // CSV format
    const records = result.data.map((entry) => ({
      alert_id: entry.alertId,
      alert_name: entry.alertName,
      owner_type: entry.ownerType,
      owner_id: entry.ownerId,
      created_by: entry.createdBy,
      created_at: entry.createdAt.toISOString(),
      escalation_contacts: entry.escalationContacts
        .map((ec) => `${ec.contactUserId}(${ec.order})`)
        .join("; "),
    }));

    return stringify(records, {
      header: true,
      columns: [
        "alert_id",
        "alert_name",
        "owner_type",
        "owner_id",
        "created_by",
        "created_at",
        "escalation_contacts",
      ],
    });
  }

  /**
   * Search ownership by query string
   */
  async searchOwnership(
    query: string,
    pagination: PaginationParams = { page: 1, limit: 50 }
  ): Promise<PaginatedOwnershipMatrix> {
    const db = getDatabase();
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;
    const searchPattern = `%${query}%`;

    // Search across alert names and owner IDs
    let searchQuery = db("alert_ownership")
      .join("alert_rules", "alert_ownership.alert_id", "alert_rules.id")
      .where((builder) => {
        builder
          .where("alert_rules.name", "ilike", searchPattern)
          .orWhere("alert_ownership.owner_id", "ilike", searchPattern);
      })
      .select(
        "alert_ownership.alert_id",
        "alert_rules.name as alert_name",
        "alert_ownership.owner_type",
        "alert_ownership.owner_id",
        "alert_ownership.created_by",
        "alert_ownership.created_at"
      );

    const countQuery = db("alert_ownership")
      .join("alert_rules", "alert_ownership.alert_id", "alert_rules.id")
      .where((builder) => {
        builder
          .where("alert_rules.name", "ilike", searchPattern)
          .orWhere("alert_ownership.owner_id", "ilike", searchPattern);
      });

    searchQuery = searchQuery
      .orderBy("alert_ownership.created_at", "desc")
      .limit(limit)
      .offset(offset);

    const [rows, countResult] = await Promise.all([
      searchQuery,
      countQuery.count("* as count").first(),
    ]);

    const total = Number(countResult?.count ?? 0);

    // Fetch escalation contacts
    const alertIds = rows.map((r: any) => r.alert_id);
    const escalationContacts = alertIds.length > 0
      ? await db("escalation_contacts")
          .whereIn("alert_id", alertIds)
          .orderBy("order", "asc")
      : [];

    const data: OwnershipMatrixEntry[] = rows.map((row: any) => ({
      alertId: row.alert_id,
      alertName: row.alert_name,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      escalationContacts: escalationContacts
        .filter((ec: any) => ec.alert_id === row.alert_id)
        .map((ec: any) => ({
          contactUserId: ec.contact_user_id,
          order: ec.order,
        })),
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get ownership matrix grouped by team
   */
  private async getGroupedByTeam(
    baseQuery: any
  ): Promise<GroupedOwnershipMatrix> {
    const db = getDatabase();

    // Get all team ownerships
    const rows = await baseQuery
      .where("alert_ownership.owner_type", "team")
      .orderBy("alert_ownership.owner_id", "asc")
      .orderBy("alert_ownership.created_at", "desc");

    // Fetch escalation contacts
    const alertIds = rows.map((r: any) => r.alert_id);
    const escalationContacts = alertIds.length > 0
      ? await db("escalation_contacts")
          .whereIn("alert_id", alertIds)
          .orderBy("order", "asc")
      : [];

    // Group by team
    const teamMap = new Map<string, OwnershipMatrixEntry[]>();

    for (const row of rows) {
      const teamId = row.owner_id;
      if (!teamMap.has(teamId)) {
        teamMap.set(teamId, []);
      }

      teamMap.get(teamId)!.push({
        alertId: row.alert_id,
        alertName: row.alert_name,
        ownerType: row.owner_type,
        ownerId: row.owner_id,
        createdBy: row.created_by,
        createdAt: new Date(row.created_at),
        escalationContacts: escalationContacts
          .filter((ec: any) => ec.alert_id === row.alert_id)
          .map((ec: any) => ({
            contactUserId: ec.contact_user_id,
            order: ec.order,
          })),
      });
    }

    return {
      teams: Array.from(teamMap.entries()).map(([teamId, alerts]) => ({
        teamId,
        alerts,
      })),
    };
  }

  private mapOwnership(row: Record<string, unknown>): AlertOwnership {
    return {
      id: row.id as string,
      alertId: row.alert_id as string,
      ownerType: row.owner_type as OwnerType,
      ownerId: row.owner_id as string,
      createdBy: row.created_by as string,
      createdAt: new Date(row.created_at as string),
    };
  }

  private mapEscalationContact(row: Record<string, unknown>): EscalationContact {
    return {
      id: row.id as string,
      alertId: row.alert_id as string,
      contactUserId: row.contact_user_id as string,
      order: row.order as number,
      createdBy: row.created_by as string,
      createdAt: new Date(row.created_at as string),
    };
  }
}
