import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { IncidentService } from "./incident.service.js";
import type { AlertEvent, AlertPriority, AlertType } from "./alert.service.js";
import type { BridgeIncident } from "./incident.service.js";

/**
 * Configuration for deduplication.
 * - windowMs: time window within which alerts are considered duplicates.
 * - severityOrder: defines escalation hierarchy.
 */
const DEDUP_CONFIG = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  severityOrder: ["low", "medium", "high", "critical"] as AlertPriority[],
};

export class AlertDeduplicationService {
  private static instance: AlertDeduplicationService;
  private incidentService = new IncidentService();

  private constructor() {}

  public static getInstance(): AlertDeduplicationService {
    if (!AlertDeduplicationService.instance) {
      AlertDeduplicationService.instance = new AlertDeduplicationService();
    }
    return AlertDeduplicationService.instance;
  }

  /**
   * Find an open incident that matches the alert within the deduplication window.
   */
  private async findMatchingIncident(event: AlertEvent): Promise<BridgeIncident | null> {
    const db = getDatabase();
    const now = new Date();
    const windowStart = new Date(now.getTime() - DEDUP_CONFIG.windowMs);

    // Simple matching on assetCode, alertType and open status.
    const row = await db("bridge_incidents")
      .where({ asset_code: event.assetCode, status: "open" })
      .andWhere((qb: any) => {
        qb.where("source_type", event.alertType).orWhere("source_type", null);
      })
      .andWhere("created_at", ">=", windowStart)
      .orderBy("created_at", "desc")
      .first();

    return row ? this.incidentService.mapDatabaseRow(row) : null;
  }

  /**
   * Merge the alert into an existing incident or create a new one.
   */
  public async deduplicate(event: AlertEvent): Promise<BridgeIncident> {
    const matching = await this.findMatchingIncident(event);
    if (matching) {
      // Escalate severity if needed.
      const newSeverity = this.escalateSeverity(matching.severity, event.priority);
      if (newSeverity !== matching.severity) {
        await this.incidentService.updateIncidentStatus(matching.id, "investigating"); // placeholder for severity update
        // In a full implementation we would update the severity field.
      }
      logger.info({ incidentId: matching.id, alertId: event.eventId }, "Alert deduplicated into existing incident");
      return matching;
    }

    // No matching incident – create a new one.
    const payload = {
      bridgeId: "unknown", // Bridge id may be derived elsewhere; placeholder.
      assetCode: event.assetCode,
      severity: event.priority as any, // map priority to severity directly.
      title: `Alert: ${event.alertType} on ${event.assetCode}`,
      description: `Triggered value ${event.triggeredValue} exceeded threshold ${event.threshold}`,
      sourceUrl: null,
      sourceType: event.alertType,
      sourceExternalId: null,
      sourceRepository: null,
      sourceRepoAvatarUrl: null,
      sourceActor: null,
      sourceAttribution: {},
      followUpActions: [],
      occurredAt: event.time.toISOString(),
    };
    const incident = await this.incidentService.createIncident(payload);
    logger.info({ incidentId: incident.id }, "New incident created for deduplicated alert");
    return incident;
  }

  /**
   * Determine the higher severity between current incident severity and incoming alert priority.
   */
  private escalateSeverity(current: string, incomingPriority: AlertPriority): string {
    const order = DEDUP_CONFIG.severityOrder;
    const curIdx = order.indexOf(current as any);
    const incIdx = order.indexOf(incomingPriority);
    return incIdx > curIdx ? incomingPriority : current;
  }
}

export const alertDeduplicationService = AlertDeduplicationService.getInstance();
