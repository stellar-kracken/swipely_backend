/**
 * Maintenance Window Scheduler Service
 * Manages maintenance windows and suppresses alerts during approved work periods
 */

import { getDatabase } from "../database/connection";
import { logger } from "../utils/logger";
import { randomBytes } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MaintenanceStatus =
  | "scheduled"
  | "active"
  | "completed"
  | "cancelled";
export type MaintenanceScope = "global" | "bridge" | "asset" | "service";

export interface MaintenanceWindow {
  id: string;
  title: string;
  description: string;
  scope: MaintenanceScope;
  scope_identifier: string | null;
  start_time: Date;
  end_time: Date;
  status: MaintenanceStatus;
  suppress_alerts: boolean;
  alert_types_suppressed: string[];
  created_by: string;
  approved_by: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  timezone: string;
}

export interface MaintenanceAuditLog {
  id: string;
  window_id: string;
  action:
    | "created"
    | "updated"
    | "started"
    | "completed"
    | "cancelled"
    | "approved";
  performed_by: string;
  details: Record<string, unknown>;
  timestamp: Date;
}

// ─── Maintenance Service ─────────────────────────────────────────────────────

export class MaintenanceService {
  /**
   * Create maintenance window
   */
  async createWindow(
    window: Omit<
      MaintenanceWindow,
      | "id"
      | "status"
      | "approved_by"
      | "approved_at"
      | "created_at"
      | "updated_at"
    >,
  ): Promise<MaintenanceWindow> {
    const db = getDatabase();

    try {
      const windowId = randomBytes(16).toString("hex");

      const newWindow = {
        id: windowId,
        ...window,
        alert_types_suppressed: JSON.stringify(window.alert_types_suppressed),
        status: "scheduled" as MaintenanceStatus,
        approved_by: null,
        approved_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db("maintenance_windows").insert(newWindow);

      // Audit log
      await this.logAction(windowId, "created", window.created_by, {
        title: window.title,
        start_time: window.start_time,
        end_time: window.end_time,
      });

      logger.info(
        { windowId, title: window.title },
        "Maintenance window created",
      );

      return {
        ...newWindow,
        alert_types_suppressed: window.alert_types_suppressed,
      };
    } catch (error) {
      logger.error({ error }, "Failed to create maintenance window");
      throw error;
    }
  }

  /**
   * Get maintenance window
   */
  async getWindow(windowId: string): Promise<MaintenanceWindow | null> {
    const db = getDatabase();

    try {
      const window = await db("maintenance_windows")
        .where({ id: windowId })
        .first();

      if (!window) {
        return null;
      }

      return {
        ...window,
        alert_types_suppressed: JSON.parse(
          window.alert_types_suppressed || "[]",
        ),
      };
    } catch (error) {
      logger.error({ error, windowId }, "Failed to get maintenance window");
      return null;
    }
  }

  /**
   * Update maintenance window
   */
  async updateWindow(
    windowId: string,
    updates: Partial<
      Omit<MaintenanceWindow, "id" | "created_at" | "created_by">
    >,
    updatedBy: string,
  ): Promise<MaintenanceWindow | null> {
    const db = getDatabase();

    try {
      const existing = await this.getWindow(windowId);
      if (!existing) {
        return null;
      }

      const updateData: any = {
        ...updates,
        updated_at: new Date(),
      };

      if (updates.alert_types_suppressed) {
        updateData.alert_types_suppressed = JSON.stringify(
          updates.alert_types_suppressed,
        );
      }

      await db("maintenance_windows")
        .where({ id: windowId })
        .update(updateData);

      // Audit log
      await this.logAction(windowId, "updated", updatedBy, updates);

      logger.info({ windowId }, "Maintenance window updated");

      return await this.getWindow(windowId);
    } catch (error) {
      logger.error({ error, windowId }, "Failed to update maintenance window");
      throw error;
    }
  }

  /**
   * Approve maintenance window
   */
  async approveWindow(windowId: string, approvedBy: string): Promise<void> {
    const db = getDatabase();

    try {
      await db("maintenance_windows").where({ id: windowId }).update({
        approved_by: approvedBy,
        approved_at: new Date(),
        updated_at: new Date(),
      });

      await this.logAction(windowId, "approved", approvedBy, {});

      logger.info({ windowId, approvedBy }, "Maintenance window approved");
    } catch (error) {
      logger.error({ error, windowId }, "Failed to approve maintenance window");
      throw error;
    }
  }

  /**
   * Cancel maintenance window
   */
  async cancelWindow(windowId: string, cancelledBy: string): Promise<void> {
    const db = getDatabase();

    try {
      await db("maintenance_windows").where({ id: windowId }).update({
        status: "cancelled",
        updated_at: new Date(),
      });

      await this.logAction(windowId, "cancelled", cancelledBy, {});

      logger.info({ windowId, cancelledBy }, "Maintenance window cancelled");
    } catch (error) {
      logger.error({ error, windowId }, "Failed to cancel maintenance window");
      throw error;
    }
  }

  /**
   * Check if alert should be suppressed
   */
  async shouldSuppressAlert(
    alertType: string,
    scope?: { type: MaintenanceScope; identifier?: string },
  ): Promise<boolean> {
    const db = getDatabase();

    try {
      const now = new Date();

      let query = db("maintenance_windows")
        .where("status", "active")
        .where("suppress_alerts", true)
        .where("start_time", "<=", now)
        .where("end_time", ">=", now);

      // Check scope
      if (scope) {
        query = query.where((builder) => {
          builder.where("scope", "global").orWhere((subBuilder) => {
            subBuilder
              .where("scope", scope.type)
              .where("scope_identifier", scope.identifier || null);
          });
        });
      } else {
        query = query.where("scope", "global");
      }

      const windows = await query;

      // Check if any window suppresses this alert type
      for (const window of windows) {
        const suppressedTypes = JSON.parse(
          window.alert_types_suppressed || "[]",
        );
        if (
          suppressedTypes.includes(alertType) ||
          suppressedTypes.includes("*")
        ) {
          logger.debug(
            { windowId: window.id, alertType },
            "Alert suppressed by maintenance window",
          );
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error({ error, alertType }, "Failed to check alert suppression");
      return false;
    }
  }

  /**
   * Get active maintenance windows
   */
  async getActiveWindows(): Promise<MaintenanceWindow[]> {
    const db = getDatabase();

    try {
      const now = new Date();

      const windows = await db("maintenance_windows")
        .where("status", "active")
        .where("start_time", "<=", now)
        .where("end_time", ">=", now)
        .orderBy("start_time");

      return windows.map((w: any) => ({
        ...w,
        alert_types_suppressed: JSON.parse(w.alert_types_suppressed || "[]"),
      }));
    } catch (error) {
      logger.error({ error }, "Failed to get active windows");
      return [];
    }
  }

  /**
   * Get upcoming maintenance windows
   */
  async getUpcomingWindows(limit: number = 10): Promise<MaintenanceWindow[]> {
    const db = getDatabase();

    try {
      const now = new Date();

      const windows = await db("maintenance_windows")
        .where("status", "scheduled")
        .where("start_time", ">", now)
        .orderBy("start_time")
        .limit(limit);

      return windows.map((w: any) => ({
        ...w,
        alert_types_suppressed: JSON.parse(w.alert_types_suppressed || "[]"),
      }));
    } catch (error) {
      logger.error({ error }, "Failed to get upcoming windows");
      return [];
    }
  }

  /**
   * Process maintenance window transitions
   */
  async processWindowTransitions(): Promise<void> {
    const db = getDatabase();

    try {
      const now = new Date();

      // Start scheduled windows
      const toStart = await db("maintenance_windows")
        .where("status", "scheduled")
        .where("start_time", "<=", now)
        .where("end_time", ">", now);

      for (const window of toStart) {
        await db("maintenance_windows")
          .where({ id: window.id })
          .update({ status: "active", updated_at: now });

        await this.logAction(window.id, "started", "system", {});
        logger.info({ windowId: window.id }, "Maintenance window started");
      }

      // Complete active windows
      const toComplete = await db("maintenance_windows")
        .where("status", "active")
        .where("end_time", "<=", now);

      for (const window of toComplete) {
        await db("maintenance_windows")
          .where({ id: window.id })
          .update({ status: "completed", updated_at: now });

        await this.logAction(window.id, "completed", "system", {});
        logger.info({ windowId: window.id }, "Maintenance window completed");
      }
    } catch (error) {
      logger.error({ error }, "Failed to process window transitions");
    }
  }

  /**
   * Get audit trail
   */
  async getAuditTrail(windowId: string): Promise<MaintenanceAuditLog[]> {
    const db = getDatabase();

    try {
      const logs = await db("maintenance_audit_logs")
        .where({ window_id: windowId })
        .orderBy("timestamp", "desc");

      return logs.map((log: any) => ({
        ...log,
        details: JSON.parse(log.details || "{}"),
      }));
    } catch (error) {
      logger.error({ error, windowId }, "Failed to get audit trail");
      return [];
    }
  }

  /**
   * Log action
   */
  private async logAction(
    windowId: string,
    action: MaintenanceAuditLog["action"],
    performedBy: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const db = getDatabase();

    try {
      await db("maintenance_audit_logs").insert({
        id: randomBytes(16).toString("hex"),
        window_id: windowId,
        action,
        performed_by: performedBy,
        details: JSON.stringify(details),
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error({ error, windowId, action }, "Failed to log action");
    }
  }

  /**
   * Get all windows with filters
   */
  async getAllWindows(filters?: {
    status?: MaintenanceStatus;
    scope?: MaintenanceScope;
    startDate?: Date;
    endDate?: Date;
  }): Promise<MaintenanceWindow[]> {
    const db = getDatabase();

    try {
      let query = db("maintenance_windows");

      if (filters?.status) {
        query = query.where("status", filters.status);
      }
      if (filters?.scope) {
        query = query.where("scope", filters.scope);
      }
      if (filters?.startDate) {
        query = query.where("start_time", ">=", filters.startDate);
      }
      if (filters?.endDate) {
        query = query.where("end_time", "<=", filters.endDate);
      }

      const windows = await query.orderBy("start_time", "desc");

      return windows.map((w: any) => ({
        ...w,
        alert_types_suppressed: JSON.parse(w.alert_types_suppressed || "[]"),
      }));
    } catch (error) {
      logger.error({ error }, "Failed to get all windows");
      return [];
    }
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const maintenanceService = new MaintenanceService();
