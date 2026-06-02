import crypto from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export interface AlertWindow {
  id: string;
  assetCode: string;
  alertType: string;
  windowStart: Date;
  windowEnd: Date;
  alertCount: number;
  summaryStats: Record<string, unknown>;
  status: "open" | "closed" | "processing";
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertWindowSummary {
  id: string;
  windowId: string;
  severityBreakdown: Record<string, number>;
  topAlerts: Record<string, unknown>[];
  aggregatedMetrics: Record<string, unknown>;
  createdAt: Date;
}

export interface GroupedAlert {
  id: string;
  ruleId: string;
  assetCode: string;
  alertType: string;
  priority: string;
  triggeredValue: number;
  threshold: number;
  occurredAt: Date;
}

export interface WindowConfig {
  windowMinutes: number;
  groupingKeys: string[];
}

const DEFAULT_CONFIG: WindowConfig = {
  windowMinutes: 60,
  groupingKeys: ["assetCode", "alertType"],
};

export class AlertWindowingService {
  private static instance: AlertWindowingService;
  private config: WindowConfig;

  private constructor(config: Partial<WindowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public static getInstance(config?: Partial<WindowConfig>): AlertWindowingService {
    if (!AlertWindowingService.instance) {
      AlertWindowingService.instance = new AlertWindowingService(config);
    }
    return AlertWindowingService.instance;
  }

  public setConfig(config: Partial<WindowConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public determineWindowKey(alert: {
    assetCode: string;
    alertType: string;
  }): string {
    const parts = this.config.groupingKeys.map((key) =>
      key === "assetCode" ? alert.assetCode : alert.alertType
    );
    return parts.join("::");
  }

  public async assignToWindow(alert: GroupedAlert): Promise<AlertWindow> {
    const db = getDatabase();
    const windowKey = this.determineWindowKey(alert);
    const windowStart = this.getWindowStart(alert.occurredAt);

    let window = await db("alert_windows")
      .where("asset_code", alert.assetCode)
      .where("alert_type", alert.alertType)
      .where("window_start", windowStart)
      .where("status", "open")
      .first();

    if (window) {
      const currentCount = (window.alert_count as number) + 1;
      const currentStats = JSON.parse(
        typeof window.summary_stats === "string"
          ? window.summary_stats
          : JSON.stringify(window.summary_stats)
      ) as Record<string, unknown>;

      const updatedStats = this.mergeAlertIntoStats(currentStats, alert);

      const [updated] = await db("alert_windows")
        .where("id", window.id)
        .update({
          alert_count: currentCount,
          summary_stats: JSON.stringify(updatedStats),
          updated_at: new Date(),
        })
        .returning("*");

      logger.info(
        { windowId: window.id, alertCount: currentCount },
        "Alert added to existing window"
      );
      return this.mapRow(updated ?? window);
    }

    const id = crypto.randomUUID();
    const initialStats = this.buildInitialStats(alert);
    const windowEnd = new Date(windowStart.getTime() + this.config.windowMinutes * 60 * 1000);

    const [row] = await db("alert_windows")
      .insert({
        id,
        asset_code: alert.assetCode,
        alert_type: alert.alertType,
        window_start: windowStart,
        window_end: windowEnd,
        alert_count: 1,
        summary_stats: JSON.stringify(initialStats),
        status: "open",
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");

    logger.info({ id, assetCode: alert.assetCode }, "New alert window created");
    return this.mapRow(row);
  }

  public async closeWindow(windowId: string): Promise<AlertWindow | null> {
    const db = getDatabase();
    const [row] = await db("alert_windows")
      .where("id", windowId)
      .update({ status: "closed", updated_at: new Date() })
      .returning("*");

    if (!row) return null;

    await this.generateSummary(windowId);
    logger.info({ windowId }, "Alert window closed");
    return this.mapRow(row);
  }

  public async getWindow(windowId: string): Promise<AlertWindow | null> {
    const db = getDatabase();
    const row = await db("alert_windows").where("id", windowId).first();
    return row ? this.mapRow(row) : null;
  }

  public async listWindows(params: {
    assetCode?: string;
    alertType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<AlertWindow[]> {
    const db = getDatabase();
    let query = db("alert_windows").orderBy("window_start", "desc");

    if (params.assetCode) query = query.where("asset_code", params.assetCode);
    if (params.alertType) query = query.where("alert_type", params.alertType);
    if (params.status) query = query.where("status", params.status);
    if (params.limit) query = query.limit(params.limit);
    if (params.offset) query = query.offset(params.offset);

    const rows = await query;
    return rows.map((r: Record<string, unknown>) => this.mapRow(r));
  }

  public async getSummary(windowId: string): Promise<AlertWindowSummary | null> {
    const db = getDatabase();
    const row = await db("alert_window_summaries")
      .where("window_id", windowId)
      .orderBy("created_at", "desc")
      .first();
    if (!row) return null;

    return {
      id: row.id as string,
      windowId: row.window_id as string,
      severityBreakdown: JSON.parse(
        typeof row.severity_breakdown === "string"
          ? row.severity_breakdown
          : JSON.stringify(row.severity_breakdown)
      ),
      topAlerts: JSON.parse(
        typeof row.top_alerts === "string"
          ? row.top_alerts
          : JSON.stringify(row.top_alerts)
      ),
      aggregatedMetrics: JSON.parse(
        typeof row.aggregated_metrics === "string"
          ? row.aggregated_metrics
          : JSON.stringify(row.aggregated_metrics)
      ),
      createdAt: row.created_at as Date,
    };
  }

  private async generateSummary(windowId: string): Promise<void> {
    const db = getDatabase();
    const window = await db("alert_windows").where("id", windowId).first();
    if (!window) return;

    const stats =
      typeof window.summary_stats === "string"
        ? JSON.parse(window.summary_stats)
        : window.summary_stats;

    const severityBreakdown: Record<string, number> = stats.severity ?? {};
    const topAlerts: Record<string, unknown>[] = stats.recentAlerts ?? [];
    const aggregatedMetrics: Record<string, unknown> = {
      totalAlerts: window.alert_count,
      windowDurationMinutes: this.config.windowMinutes,
      avgAlertPerMinute:
        ((window.alert_count as number) / this.config.windowMinutes).toFixed(2),
      uniqueTypes: Object.keys(severityBreakdown).length,
    };

    await db("alert_window_summaries").insert({
      id: crypto.randomUUID(),
      window_id: windowId,
      severity_breakdown: JSON.stringify(severityBreakdown),
      top_alerts: JSON.stringify(topAlerts),
      aggregated_metrics: JSON.stringify(aggregatedMetrics),
      created_at: new Date(),
    });
  }

  public async autoCloseExpiredWindows(): Promise<number> {
    const db = getDatabase();
    const now = new Date();
    const expired = await db("alert_windows")
      .where("window_end", "<", now)
      .where("status", "open");

    for (const window of expired) {
      await this.closeWindow(window.id as string);
    }

    if (expired.length > 0) {
      logger.info({ count: expired.length }, "Auto-closed expired alert windows");
    }
    return expired.length;
  }

  private getWindowStart(timestamp: Date): Date {
    const ms = this.config.windowMinutes * 60 * 1000;
    return new Date(Math.floor(timestamp.getTime() / ms) * ms);
  }

  private buildInitialStats(alert: GroupedAlert): Record<string, unknown> {
    return {
      firstAlertAt: alert.occurredAt.toISOString(),
      lastAlertAt: alert.occurredAt.toISOString(),
      highestPriority: alert.priority,
      severity: { [alert.priority]: 1 },
      recentAlerts: [
        {
          id: alert.id,
          ruleId: alert.ruleId,
          priority: alert.priority,
          value: alert.triggeredValue,
          threshold: alert.threshold,
          time: alert.occurredAt.toISOString(),
        },
      ],
    };
  }

  private mergeAlertIntoStats(
    stats: Record<string, unknown>,
    alert: GroupedAlert
  ): Record<string, unknown> {
    const severity = (stats.severity as Record<string, number>) ?? {};
    severity[alert.priority] = (severity[alert.priority] ?? 0) + 1;

    const recentAlerts = (stats.recentAlerts as Record<string, unknown>[]) ?? [];
    recentAlerts.unshift({
      id: alert.id,
      ruleId: alert.ruleId,
      priority: alert.priority,
      value: alert.triggeredValue,
      threshold: alert.threshold,
      time: alert.occurredAt.toISOString(),
    });

    const maxRecent = 20;
    if (recentAlerts.length > maxRecent) {
      recentAlerts.length = maxRecent;
    }

    return {
      ...stats,
      lastAlertAt: alert.occurredAt.toISOString(),
      highestPriority: this.getHigherPriority(
        stats.highestPriority as string,
        alert.priority
      ),
      severity,
      recentAlerts,
    };
  }

  private getHigherPriority(a: string, b: string): string {
    const order = ["low", "medium", "high", "critical"];
    return order.indexOf(a) >= order.indexOf(b) ? a : b;
  }

  private mapRow(row: Record<string, unknown>): AlertWindow {
    return {
      id: row.id as string,
      assetCode: row.asset_code as string,
      alertType: row.alert_type as string,
      windowStart: row.window_start as Date,
      windowEnd: row.window_end as Date,
      alertCount: row.alert_count as number,
      summaryStats:
        typeof row.summary_stats === "string"
          ? JSON.parse(row.summary_stats as string)
          : (row.summary_stats as Record<string, unknown>),
      status: row.status as AlertWindow["status"],
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }
}

export const alertWindowingService = AlertWindowingService.getInstance();
