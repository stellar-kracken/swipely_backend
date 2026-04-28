import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { redis } from "../utils/redis.js";
import { REDIS_WS_CHANNELS } from "../api/websocket/types.js";
import { webhookService } from "./webhook.service.js";
import { emailNotificationService } from "./email.service.js";
import { PreferencesService } from "./preferences.service.js";

const fetch = globalThis.fetch;

export type RoutingChannel = "in_app" | "webhook" | "email";
export type RoutingSeverity = "critical" | "high" | "medium" | "low";
export type RoutingAuditStatus =
  | "queued"
  | "delivered"
  | "suppressed"
  | "failed"
  | "fallback";

export interface AlertRoutingRule {
  id: string;
  name: string;
  ownerAddress: string | null;
  severityLevels: RoutingSeverity[];
  assetCodes: string[];
  sourceTypes: string[];
  channels: RoutingChannel[];
  fallbackChannels: RoutingChannel[];
  suppressionWindowSeconds: number;
  priorityOrder: number;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertRoutingAuditEntry {
  id: string;
  eventTime: Date;
  alertRuleId: string;
  routingRuleId: string | null;
  ownerAddress: string;
  assetCode: string;
  sourceType: string;
  severity: RoutingSeverity;
  channel: string;
  status: RoutingAuditStatus;
  reason: string | null;
  attemptCount: number;
  latencyMs: number | null;
  createdAt: Date;
}

export interface RouteableAlert {
  eventTime: Date;
  alertRuleId: string;
  ownerAddress: string;
  ruleName: string;
  assetCode: string;
  sourceType: string;
  severity: RoutingSeverity;
  triggeredValue: number;
  threshold: number;
  metric: string;
  webhookUrl?: string | null;
}

export interface CreateAlertRoutingRuleInput {
  name: string;
  ownerAddress?: string | null;
  severityLevels?: RoutingSeverity[];
  assetCodes?: string[];
  sourceTypes?: string[];
  channels: RoutingChannel[];
  fallbackChannels?: RoutingChannel[];
  suppressionWindowSeconds?: number;
  priorityOrder?: number;
  isActive?: boolean;
  createdBy?: string | null;
}

export interface UpdateAlertRoutingRuleInput {
  name?: string;
  ownerAddress?: string | null;
  severityLevels?: RoutingSeverity[];
  assetCodes?: string[];
  sourceTypes?: string[];
  channels?: RoutingChannel[];
  fallbackChannels?: RoutingChannel[];
  suppressionWindowSeconds?: number;
  priorityOrder?: number;
  isActive?: boolean;
}

export interface AuditHistoryFilters {
  ownerAddress?: string;
  status?: RoutingAuditStatus;
  channel?: string;
  limit?: number;
}

interface OwnerRoutingPreferences {
  minSeverity: RoutingSeverity;
  channels: RoutingChannel[];
  mutedAssets: string[];
}

interface DispatchResult {
  channel: RoutingChannel;
  status: "queued" | "delivered" | "failed" | "suppressed";
  reason?: string;
  attemptCount?: number;
  latencyMs?: number;
}

const SEVERITY_RANK: Record<RoutingSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function sanitizeAssetCodes(items: string[] | undefined): string[] {
  return unique((items ?? []).map((entry) => entry.trim().toUpperCase()).filter(Boolean));
}

function sanitizeSourceTypes(items: string[] | undefined): string[] {
  return unique((items ?? []).map((entry) => entry.trim()).filter(Boolean));
}

function sanitizeChannels(items: RoutingChannel[] | undefined): RoutingChannel[] {
  const allowed = new Set<RoutingChannel>(["in_app", "webhook", "email"]);
  return unique((items ?? []).filter((channel): channel is RoutingChannel => allowed.has(channel)));
}

function mapRowToRule(row: Record<string, unknown>): AlertRoutingRule {
  return {
    id: row.id as string,
    name: row.name as string,
    ownerAddress: (row.owner_address as string | null) ?? null,
    severityLevels: parseJsonArray<RoutingSeverity>(row.severity_levels),
    assetCodes: parseJsonArray<string>(row.asset_codes),
    sourceTypes: parseJsonArray<string>(row.source_types),
    channels: parseJsonArray<RoutingChannel>(row.channels),
    fallbackChannels: parseJsonArray<RoutingChannel>(row.fallback_channels),
    suppressionWindowSeconds: Number(row.suppression_window_seconds ?? 0),
    priorityOrder: Number(row.priority_order ?? 100),
    isActive: Boolean(row.is_active),
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapRowToAudit(row: Record<string, unknown>): AlertRoutingAuditEntry {
  return {
    id: row.id as string,
    eventTime: new Date(row.event_time as string),
    alertRuleId: row.alert_rule_id as string,
    routingRuleId: (row.routing_rule_id as string | null) ?? null,
    ownerAddress: row.owner_address as string,
    assetCode: row.asset_code as string,
    sourceType: row.source_type as string,
    severity: row.severity as RoutingSeverity,
    channel: row.channel as string,
    status: row.status as RoutingAuditStatus,
    reason: (row.reason as string | null) ?? null,
    attemptCount: Number(row.attempt_count ?? 0),
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    createdAt: new Date(row.created_at as string),
  };
}

export class AlertRoutingService {
  private readonly preferencesService = new PreferencesService();

  async createRule(input: CreateAlertRoutingRuleInput): Promise<AlertRoutingRule> {
    const db = getDatabase();

    const severityLevels = sanitizeSeverityLevels(input.severityLevels);
    const channels = sanitizeChannels(input.channels);
    const fallbackChannels = sanitizeChannels(input.fallbackChannels);

    const [row] = await db("alert_routing_rules")
      .insert({
        name: input.name,
        owner_address: input.ownerAddress ?? null,
        severity_levels: JSON.stringify(severityLevels),
        asset_codes: JSON.stringify(sanitizeAssetCodes(input.assetCodes)),
        source_types: JSON.stringify(sanitizeSourceTypes(input.sourceTypes)),
        channels: JSON.stringify(channels.length > 0 ? channels : ["in_app"]),
        fallback_channels: JSON.stringify(
          fallbackChannels.length > 0 ? fallbackChannels : ["in_app"]
        ),
        suppression_window_seconds: Math.max(0, input.suppressionWindowSeconds ?? 0),
        priority_order: input.priorityOrder ?? 100,
        is_active: input.isActive ?? true,
        created_by: input.createdBy ?? null,
      })
      .returning("*");

    return mapRowToRule(row as Record<string, unknown>);
  }

  async updateRule(
    id: string,
    input: UpdateAlertRoutingRuleInput
  ): Promise<AlertRoutingRule | null> {
    const db = getDatabase();
    const patch: Record<string, unknown> = {};

    if (input.name !== undefined) patch.name = input.name;
    if (input.ownerAddress !== undefined) patch.owner_address = input.ownerAddress;
    if (input.severityLevels !== undefined) {
      patch.severity_levels = JSON.stringify(sanitizeSeverityLevels(input.severityLevels));
    }
    if (input.assetCodes !== undefined) {
      patch.asset_codes = JSON.stringify(sanitizeAssetCodes(input.assetCodes));
    }
    if (input.sourceTypes !== undefined) {
      patch.source_types = JSON.stringify(sanitizeSourceTypes(input.sourceTypes));
    }
    if (input.channels !== undefined) {
      const channels = sanitizeChannels(input.channels);
      patch.channels = JSON.stringify(channels.length > 0 ? channels : ["in_app"]);
    }
    if (input.fallbackChannels !== undefined) {
      const fallbackChannels = sanitizeChannels(input.fallbackChannels);
      patch.fallback_channels = JSON.stringify(
        fallbackChannels.length > 0 ? fallbackChannels : ["in_app"]
      );
    }
    if (input.suppressionWindowSeconds !== undefined) {
      patch.suppression_window_seconds = Math.max(0, input.suppressionWindowSeconds);
    }
    if (input.priorityOrder !== undefined) patch.priority_order = input.priorityOrder;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const [row] = await db("alert_routing_rules")
      .where({ id })
      .update(patch)
      .returning("*");

    if (!row) return null;
    return mapRowToRule(row as Record<string, unknown>);
  }

  async deleteRule(id: string): Promise<boolean> {
    const db = getDatabase();
    const deleted = await db("alert_routing_rules").where({ id }).delete();
    return deleted > 0;
  }

  async listRules(ownerAddress?: string): Promise<AlertRoutingRule[]> {
    const db = getDatabase();
    let query = db("alert_routing_rules").orderBy("priority_order", "asc");

    if (ownerAddress) {
      query = query.where((builder: any) => {
        builder.where("owner_address", ownerAddress).orWhereNull("owner_address");
      });
    }

    const rows = await query;
    return rows.map((row: Record<string, unknown>) => mapRowToRule(row));
  }

  async getAuditHistory(filters: AuditHistoryFilters = {}): Promise<AlertRoutingAuditEntry[]> {
    const db = getDatabase();
    let query = db("alert_routing_audit").orderBy("created_at", "desc");

    if (filters.ownerAddress) {
      query = query.where("owner_address", filters.ownerAddress);
    }
    if (filters.status) {
      query = query.where("status", filters.status);
    }
    if (filters.channel) {
      query = query.where("channel", filters.channel);
    }

    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    const rows = await query.limit(limit);
    return rows.map((row: Record<string, unknown>) => mapRowToAudit(row));
  }

  async routeAlert(alert: RouteableAlert): Promise<void> {
    const ownerPreferences = await this.getOwnerRoutingPreferences(alert.ownerAddress);

    if (ownerPreferences.mutedAssets.includes(alert.assetCode.toUpperCase())) {
      await this.recordAudit({
        alert,
        routingRuleId: null,
        channel: "all",
        status: "suppressed",
        reason: "asset muted by user preference",
        attemptCount: 0,
      });
      return;
    }

    if (!this.meetsSeverityThreshold(alert.severity, ownerPreferences.minSeverity)) {
      await this.recordAudit({
        alert,
        routingRuleId: null,
        channel: "all",
        status: "suppressed",
        reason: "below user severity threshold",
        attemptCount: 0,
      });
      return;
    }

    const activeRules = (await this.listRules(alert.ownerAddress)).filter((rule) => rule.isActive);
    const matchedRule = activeRules.find((rule) => this.matchesRule(rule, alert)) ?? null;

    const primaryChannels = this.resolvePrimaryChannels(matchedRule, ownerPreferences);
    const suppressionWindowSeconds = matchedRule?.suppressionWindowSeconds ?? 0;

    const primaryResults = await Promise.all(
      primaryChannels.map((channel) =>
        this.dispatchChannelWithAudit(alert, matchedRule, channel, suppressionWindowSeconds, false)
      )
    );

    const hasPrimarySuccess = primaryResults.some(
      (result) => result.status === "queued" || result.status === "delivered"
    );

    if (hasPrimarySuccess || primaryResults.every((result) => result.status === "suppressed")) {
      return;
    }

    const attempted = new Set(primaryChannels);
    const fallbackChannels = this.resolveFallbackChannels(matchedRule).filter(
      (channel) => !attempted.has(channel)
    );

    await Promise.all(
      fallbackChannels.map((channel) =>
        this.dispatchChannelWithAudit(alert, matchedRule, channel, 0, true)
      )
    );
  }

  private async dispatchChannelWithAudit(
    alert: RouteableAlert,
    rule: AlertRoutingRule | null,
    channel: RoutingChannel,
    suppressionWindowSeconds: number,
    fallback: boolean
  ): Promise<DispatchResult> {
    const suppressed = await this.isSuppressed(alert, channel, suppressionWindowSeconds);
    if (suppressed) {
      await this.recordAudit({
        alert,
        routingRuleId: rule?.id ?? null,
        channel,
        status: "suppressed",
        reason: "suppression window active",
        attemptCount: 0,
      });
      return { channel, status: "suppressed", reason: "suppression window active" };
    }

    const result = await this.dispatchChannel(alert, channel);

    await this.recordAudit({
      alert,
      routingRuleId: rule?.id ?? null,
      channel,
      status:
        fallback && (result.status === "queued" || result.status === "delivered")
          ? "fallback"
          : (result.status as RoutingAuditStatus),
      reason: result.reason,
      attemptCount: result.attemptCount ?? 0,
      latencyMs: result.latencyMs,
    });

    return result;
  }

  private async dispatchChannel(
    alert: RouteableAlert,
    channel: RoutingChannel
  ): Promise<DispatchResult> {
    const started = Date.now();

    if (channel === "in_app") {
      try {
        const message = {
          type: "alert_triggered",
          channel: "alerts",
          data: {
            ruleId: alert.alertRuleId,
            assetCode: alert.assetCode,
            alertType: alert.sourceType,
            priority: alert.severity,
            triggeredValue: alert.triggeredValue,
            threshold: alert.threshold,
            metric: alert.metric,
            timestamp: alert.eventTime.toISOString(),
          },
          timestamp: new Date().toISOString(),
        };

        await redis.publish(REDIS_WS_CHANNELS.alerts, JSON.stringify(message));
        return {
          channel,
          status: "delivered",
          attemptCount: 1,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        return {
          channel,
          status: "failed",
          reason: error instanceof Error ? error.message : "failed to publish in-app alert",
          attemptCount: 1,
          latencyMs: Date.now() - started,
        };
      }
    }

    if (channel === "webhook") {
      const payload = {
        ruleId: alert.alertRuleId,
        ruleName: alert.ruleName,
        assetCode: alert.assetCode,
        alertType: alert.sourceType,
        priority: alert.severity,
        metric: alert.metric,
        triggeredValue: alert.triggeredValue,
        threshold: alert.threshold,
        timestamp: alert.eventTime.toISOString(),
      };

      try {
        const endpoints = (await webhookService.listEndpoints(alert.ownerAddress)).filter(
          (endpoint) =>
            endpoint.isActive &&
            (endpoint.filterEventTypes.length === 0 ||
              endpoint.filterEventTypes.includes("alert.triggered"))
        );

        let queuedCount = 0;
        for (const endpoint of endpoints) {
          try {
            await webhookService.queueDelivery({
              webhookEndpointId: endpoint.id,
              eventType: "alert.triggered",
              payload,
            });
            queuedCount += 1;
          } catch (error) {
            logger.warn(
              {
                endpointId: endpoint.id,
                ownerAddress: alert.ownerAddress,
                err: error,
              },
              "Failed to queue alert webhook delivery"
            );
          }
        }

        if (queuedCount > 0) {
          return {
            channel,
            status: "queued",
            attemptCount: queuedCount,
            latencyMs: Date.now() - started,
          };
        }

        if (alert.webhookUrl) {
          const response = await fetch(alert.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
          });

          if (!response.ok) {
            return {
              channel,
              status: "failed",
              reason: `direct webhook responded ${response.status}`,
              attemptCount: 1,
              latencyMs: Date.now() - started,
            };
          }

          return {
            channel,
            status: "delivered",
            attemptCount: 1,
            latencyMs: Date.now() - started,
          };
        }

        return {
          channel,
          status: "failed",
          reason: "no active webhook destinations",
          attemptCount: 0,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        return {
          channel,
          status: "failed",
          reason: error instanceof Error ? error.message : "failed to dispatch webhook",
          attemptCount: 1,
          latencyMs: Date.now() - started,
        };
      }
    }

    if (!alert.ownerAddress.includes("@")) {
      return {
        channel,
        status: "failed",
        reason: "email channel requested but owner address is not an email recipient",
        attemptCount: 0,
        latencyMs: Date.now() - started,
      };
    }

    try {
      await emailNotificationService.sendAlertEmail(
        { email: alert.ownerAddress },
        {
          alertType: alert.sourceType,
          severity: alert.severity,
          assetCode: alert.assetCode,
          message: `${alert.assetCode} ${alert.sourceType} exceeded threshold`,
          triggeredAt: alert.eventTime.toISOString(),
          metadata: {
            ruleId: alert.alertRuleId,
            ruleName: alert.ruleName,
            metric: alert.metric,
            triggeredValue: alert.triggeredValue,
            threshold: alert.threshold,
          },
        }
      );

      return {
        channel,
        status: "queued",
        attemptCount: 1,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        channel,
        status: "failed",
        reason: error instanceof Error ? error.message : "failed to queue alert email",
        attemptCount: 1,
        latencyMs: Date.now() - started,
      };
    }
  }

  private async recordAudit(params: {
    alert: RouteableAlert;
    routingRuleId: string | null;
    channel: string;
    status: RoutingAuditStatus;
    reason?: string;
    attemptCount: number;
    latencyMs?: number;
  }): Promise<void> {
    const db = getDatabase();

    await db("alert_routing_audit").insert({
      event_time: params.alert.eventTime,
      alert_rule_id: params.alert.alertRuleId,
      routing_rule_id: params.routingRuleId,
      owner_address: params.alert.ownerAddress,
      asset_code: params.alert.assetCode,
      source_type: params.alert.sourceType,
      severity: params.alert.severity,
      channel: params.channel,
      status: params.status,
      reason: params.reason ?? null,
      attempt_count: params.attemptCount,
      latency_ms: params.latencyMs ?? null,
    });
  }

  private matchesRule(rule: AlertRoutingRule, alert: RouteableAlert): boolean {
    const severityMatch =
      rule.severityLevels.length === 0 || rule.severityLevels.includes(alert.severity);
    const assetMatch =
      rule.assetCodes.length === 0 ||
      rule.assetCodes.map((entry) => entry.toUpperCase()).includes(alert.assetCode.toUpperCase());
    const sourceMatch =
      rule.sourceTypes.length === 0 || rule.sourceTypes.includes(alert.sourceType);

    return severityMatch && assetMatch && sourceMatch;
  }

  private resolvePrimaryChannels(
    matchedRule: AlertRoutingRule | null,
    ownerPreferences: OwnerRoutingPreferences
  ): RoutingChannel[] {
    const preferredChannels = ownerPreferences.channels;

    if (matchedRule) {
      const fromRule = sanitizeChannels(matchedRule.channels);
      const intersection = fromRule.filter((channel) => preferredChannels.includes(channel));
      if (intersection.length > 0) return intersection;
      if (fromRule.length > 0) return fromRule;
    }

    if (preferredChannels.length > 0) {
      return preferredChannels;
    }

    return ["in_app"];
  }

  private resolveFallbackChannels(matchedRule: AlertRoutingRule | null): RoutingChannel[] {
    if (matchedRule) {
      const configured = sanitizeChannels(matchedRule.fallbackChannels);
      if (configured.length > 0) {
        return configured;
      }
    }

    return ["in_app"];
  }

  private async isSuppressed(
    alert: RouteableAlert,
    channel: RoutingChannel,
    suppressionWindowSeconds: number
  ): Promise<boolean> {
    if (suppressionWindowSeconds <= 0) {
      return false;
    }

    const db = getDatabase();
    const cutoff = new Date(Date.now() - suppressionWindowSeconds * 1000);

    const row = await db("alert_routing_audit")
      .where({
        owner_address: alert.ownerAddress,
        asset_code: alert.assetCode,
        source_type: alert.sourceType,
        channel,
      })
      .whereIn("status", ["queued", "delivered", "fallback"])
      .where("created_at", ">=", cutoff)
      .first();

    return Boolean(row);
  }

  private meetsSeverityThreshold(
    actual: RoutingSeverity,
    minimum: RoutingSeverity
  ): boolean {
    return SEVERITY_RANK[actual] >= SEVERITY_RANK[minimum];
  }

  private async getOwnerRoutingPreferences(
    ownerAddress: string
  ): Promise<OwnerRoutingPreferences> {
    try {
      const effective = await this.preferencesService.getPreferences(ownerAddress);
      const alerts = (effective.categories.alerts ?? {}) as Record<string, unknown>;

      const channels = sanitizeChannels((alerts.channels as RoutingChannel[]) ?? ["in_app"]);
      const mutedAssets = sanitizeAssetCodes((alerts.mutedAssets as string[]) ?? []);
      const minSeverity = sanitizeSeverity((alerts.defaultSeverity as RoutingSeverity) ?? "medium");

      return {
        channels: channels.length > 0 ? channels : ["in_app"],
        mutedAssets,
        minSeverity,
      };
    } catch (error) {
      logger.warn({ ownerAddress, err: error }, "Failed to load owner routing preferences");
      return {
        channels: ["in_app"],
        mutedAssets: [],
        minSeverity: "medium",
      };
    }
  }
}

function sanitizeSeverity(value: RoutingSeverity): RoutingSeverity {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function sanitizeSeverityLevels(values: RoutingSeverity[] | undefined): RoutingSeverity[] {
  const next = unique((values ?? ["critical", "high", "medium", "low"]).map(sanitizeSeverity));
  return next.length > 0 ? next : ["critical", "high", "medium", "low"];
}

export const alertRoutingService = new AlertRoutingService();
