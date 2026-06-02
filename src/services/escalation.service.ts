/**
 * Incident Escalation Engine
 * Automatically escalates unresolved incidents based on severity, duration, and routing rules
 */

import { getDatabase } from "../database/connection";
import { logger } from "../utils/logger";
import { randomBytes } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus =
  | "open"
  | "acknowledged"
  | "investigating"
  | "resolved"
  | "closed";
export type EscalationLevel = 1 | 2 | 3 | 4 | 5;

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  current_escalation_level: EscalationLevel;
  assigned_to: string | null;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EscalationRule {
  id: string;
  name: string;
  severity: IncidentSeverity;
  from_level: EscalationLevel;
  to_level: EscalationLevel;
  timeout_minutes: number;
  require_acknowledgement: boolean;
  notification_channels: string[];
  route_to: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EscalationHistory {
  id: string;
  incident_id: string;
  from_level: EscalationLevel;
  to_level: EscalationLevel;
  reason: string;
  escalated_by: "system" | "manual";
  escalated_at: Date;
  notified_users: string[];
}

// ─── Escalation Service ──────────────────────────────────────────────────────

export class EscalationService {
  private readonly CHECK_INTERVAL_MS = 60000; // 1 minute
  private isRunning = false;

  /**
   * Create incident
   */
  async createIncident(
    incident: Omit<
      Incident,
      | "id"
      | "current_escalation_level"
      | "acknowledged_at"
      | "acknowledged_by"
      | "resolved_at"
      | "resolved_by"
      | "created_at"
      | "updated_at"
    >,
  ): Promise<Incident> {
    const db = getDatabase();

    try {
      const incidentId = randomBytes(16).toString("hex");

      const newIncident = {
        id: incidentId,
        ...incident,
        current_escalation_level: 1,
        acknowledged_at: null,
        acknowledged_by: null,
        resolved_at: null,
        resolved_by: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db("incidents").insert(newIncident);

      // Start escalation monitoring
      this.monitorIncident(incidentId);

      logger.info(
        { incidentId, severity: incident.severity },
        "Incident created",
      );

      return newIncident as Incident;
    } catch (error) {
      logger.error({ error }, "Failed to create incident");
      throw error;
    }
  }

  /**
   * Acknowledge incident
   */
  async acknowledgeIncident(
    incidentId: string,
    acknowledgedBy: string,
  ): Promise<void> {
    const db = getDatabase();

    try {
      await db("incidents").where({ id: incidentId }).update({
        status: "acknowledged",
        acknowledged_at: new Date(),
        acknowledged_by: acknowledgedBy,
        updated_at: new Date(),
      });

      logger.info({ incidentId, acknowledgedBy }, "Incident acknowledged");
    } catch (error) {
      logger.error({ error, incidentId }, "Failed to acknowledge incident");
      throw error;
    }
  }

  /**
   * Resolve incident
   */
  async resolveIncident(incidentId: string, resolvedBy: string): Promise<void> {
    const db = getDatabase();

    try {
      await db("incidents").where({ id: incidentId }).update({
        status: "resolved",
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        updated_at: new Date(),
      });

      logger.info({ incidentId, resolvedBy }, "Incident resolved");
    } catch (error) {
      logger.error({ error, incidentId }, "Failed to resolve incident");
      throw error;
    }
  }

  /**
   * Escalate incident
   */
  async escalateIncident(
    incidentId: string,
    reason: string,
    escalatedBy: "system" | "manual" = "system",
  ): Promise<void> {
    const db = getDatabase();

    try {
      const incident = await db("incidents").where({ id: incidentId }).first();

      if (!incident) {
        throw new Error("Incident not found");
      }

      // Get escalation rule
      const rule = await this.getEscalationRule(
        incident.severity,
        incident.current_escalation_level,
      );

      if (!rule) {
        logger.warn({ incidentId }, "No escalation rule found");
        return;
      }

      const newLevel = rule.to_level;

      // Update incident
      await db("incidents").where({ id: incidentId }).update({
        current_escalation_level: newLevel,
        updated_at: new Date(),
      });

      // Log escalation
      await this.logEscalation(
        incidentId,
        incident.current_escalation_level,
        newLevel,
        reason,
        escalatedBy,
        rule.route_to,
      );

      // Send notifications
      await this.sendEscalationNotifications(incident, rule);

      logger.info(
        {
          incidentId,
          fromLevel: incident.current_escalation_level,
          toLevel: newLevel,
        },
        "Incident escalated",
      );
    } catch (error) {
      logger.error({ error, incidentId }, "Failed to escalate incident");
      throw error;
    }
  }

  /**
   * Monitor incident for escalation
   */
  private async monitorIncident(incidentId: string): Promise<void> {
    const db = getDatabase();

    try {
      const incident = await db("incidents").where({ id: incidentId }).first();

      if (
        !incident ||
        incident.status === "resolved" ||
        incident.status === "closed"
      ) {
        return;
      }

      // Get escalation rule
      const rule = await this.getEscalationRule(
        incident.severity,
        incident.current_escalation_level,
      );

      if (!rule) {
        return;
      }

      // Check if timeout exceeded
      const timeInLevel = Date.now() - new Date(incident.updated_at).getTime();
      const timeoutMs = rule.timeout_minutes * 60 * 1000;

      if (timeInLevel >= timeoutMs) {
        // Check if acknowledgement is required
        if (rule.require_acknowledgement && !incident.acknowledged_at) {
          await this.escalateIncident(
            incidentId,
            `No acknowledgement after ${rule.timeout_minutes} minutes`,
          );
        } else if (!rule.require_acknowledgement) {
          await this.escalateIncident(
            incidentId,
            `Unresolved after ${rule.timeout_minutes} minutes`,
          );
        }
      }
    } catch (error) {
      logger.error({ error, incidentId }, "Failed to monitor incident");
    }
  }

  /**
   * Start escalation engine
   */
  startEngine(): void {
    if (this.isRunning) {
      logger.warn("Escalation engine already running");
      return;
    }

    this.isRunning = true;
    logger.info("Escalation engine started");

    const checkEscalations = async () => {
      if (!this.isRunning) return;

      try {
        await this.processEscalations();
      } catch (error) {
        logger.error({ error }, "Error processing escalations");
      }

      setTimeout(checkEscalations, this.CHECK_INTERVAL_MS);
    };

    checkEscalations();
  }

  /**
   * Stop escalation engine
   */
  stopEngine(): void {
    this.isRunning = false;
    logger.info("Escalation engine stopped");
  }

  /**
   * Process all pending escalations
   */
  private async processEscalations(): Promise<void> {
    const db = getDatabase();

    try {
      // Get all open incidents
      const incidents = await db("incidents")
        .whereIn("status", ["open", "acknowledged", "investigating"])
        .orderBy("created_at");

      for (const incident of incidents) {
        await this.monitorIncident(incident.id);
      }
    } catch (error) {
      logger.error({ error }, "Failed to process escalations");
    }
  }

  /**
   * Get escalation rule
   */
  private async getEscalationRule(
    severity: IncidentSeverity,
    fromLevel: EscalationLevel,
  ): Promise<EscalationRule | null> {
    const db = getDatabase();

    try {
      const rule = await db("escalation_rules")
        .where({
          severity,
          from_level: fromLevel,
          is_active: true,
        })
        .first();

      if (!rule) {
        return null;
      }

      return {
        ...rule,
        notification_channels: JSON.parse(rule.notification_channels || "[]"),
        route_to: JSON.parse(rule.route_to || "[]"),
      };
    } catch (error) {
      logger.error(
        { error, severity, fromLevel },
        "Failed to get escalation rule",
      );
      return null;
    }
  }

  /**
   * Log escalation
   */
  private async logEscalation(
    incidentId: string,
    fromLevel: EscalationLevel,
    toLevel: EscalationLevel,
    reason: string,
    escalatedBy: "system" | "manual",
    notifiedUsers: string[],
  ): Promise<void> {
    const db = getDatabase();

    try {
      await db("escalation_history").insert({
        id: randomBytes(16).toString("hex"),
        incident_id: incidentId,
        from_level: fromLevel,
        to_level: toLevel,
        reason,
        escalated_by: escalatedBy,
        escalated_at: new Date(),
        notified_users: JSON.stringify(notifiedUsers),
      });
    } catch (error) {
      logger.error({ error, incidentId }, "Failed to log escalation");
    }
  }

  /**
   * Send escalation notifications
   */
  private async sendEscalationNotifications(
    incident: Incident,
    rule: EscalationRule,
  ): Promise<void> {
    // In production, integrate with notification service
    logger.info(
      {
        incidentId: incident.id,
        channels: rule.notification_channels,
        recipients: rule.route_to,
      },
      "Escalation notifications sent",
    );
  }

  /**
   * Get incident
   */
  async getIncident(incidentId: string): Promise<Incident | null> {
    const db = getDatabase();

    try {
      return await db("incidents").where({ id: incidentId }).first();
    } catch (error) {
      logger.error({ error, incidentId }, "Failed to get incident");
      return null;
    }
  }

  /**
   * Get escalation history
   */
  async getEscalationHistory(incidentId: string): Promise<EscalationHistory[]> {
    const db = getDatabase();

    try {
      const history = await db("escalation_history")
        .where({ incident_id: incidentId })
        .orderBy("escalated_at", "desc");

      return history.map((h: any) => ({
        ...h,
        notified_users: JSON.parse(h.notified_users || "[]"),
      }));
    } catch (error) {
      logger.error({ error, incidentId }, "Failed to get escalation history");
      return [];
    }
  }

  /**
   * Create escalation rule
   */
  async createEscalationRule(
    rule: Omit<EscalationRule, "id" | "created_at" | "updated_at">,
  ): Promise<EscalationRule> {
    const db = getDatabase();

    try {
      const ruleId = randomBytes(16).toString("hex");

      const newRule = {
        id: ruleId,
        ...rule,
        notification_channels: JSON.stringify(rule.notification_channels),
        route_to: JSON.stringify(rule.route_to),
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db("escalation_rules").insert(newRule);

      logger.info({ ruleId, name: rule.name }, "Escalation rule created");

      return {
        ...newRule,
        notification_channels: rule.notification_channels,
        route_to: rule.route_to,
      };
    } catch (error) {
      logger.error({ error }, "Failed to create escalation rule");
      throw error;
    }
  }

  /**
   * Get all escalation rules
   */
  async getAllRules(): Promise<EscalationRule[]> {
    const db = getDatabase();

    try {
      const rules = await db("escalation_rules")
        .where({ is_active: true })
        .orderBy("severity")
        .orderBy("from_level");

      return rules.map((r: any) => ({
        ...r,
        notification_channels: JSON.parse(r.notification_channels || "[]"),
        route_to: JSON.parse(r.route_to || "[]"),
      }));
    } catch (error) {
      logger.error({ error }, "Failed to get all rules");
      return [];
    }
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const escalationService = new EscalationService();
