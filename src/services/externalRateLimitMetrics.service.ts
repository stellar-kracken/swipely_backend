import { randomBytes } from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export interface ProviderRateLimitSnapshot {
  providerKey: string;
  requestsCount: number;
  throttledCount: number;
  burstCount: number;
  limitRemaining: number | null;
  limitTotal: number | null;
  usagePercent: number | null;
  isThrottled: boolean;
  lastRecordedAt: string | null;
}

export interface RateLimitTrendPoint {
  bucket: string;
  requestsCount: number;
  throttledCount: number;
  burstCount: number;
}

export interface RateLimitAlert {
  providerKey: string;
  severity: "warning" | "critical";
  type: "usage" | "burst" | "throttle";
  message: string;
  timestamp: string;
}

export class ExternalRateLimitMetricsService {
  private db = getDatabase();

  async recordUsage(params: {
    providerKey: string;
    requestsCount?: number;
    throttled?: boolean;
    burst?: boolean;
    limitRemaining?: number;
    limitTotal?: number;
    resetAtEpoch?: number;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const isThrottled = params.throttled ?? false;
    const burst = params.burst ?? false;

    await this.db("external_rate_limit_metrics").insert({
      id: randomBytes(16).toString("hex"),
      provider_key: params.providerKey,
      requests_count: params.requestsCount ?? 1,
      throttled_count: isThrottled ? 1 : 0,
      burst_count: burst ? 1 : 0,
      limit_remaining: params.limitRemaining ?? null,
      limit_total: params.limitTotal ?? null,
      reset_at_epoch: params.resetAtEpoch ?? null,
      is_throttled: isThrottled,
      details: JSON.stringify(params.details ?? {}),
      recorded_at: new Date(),
    });
  }

  async getProviderSnapshots(): Promise<ProviderRateLimitSnapshot[]> {
    const rows = await this.db("external_rate_limit_metrics")
      .select("provider_key")
      .max("recorded_at as last_recorded_at")
      .groupBy("provider_key");

    const snapshots: ProviderRateLimitSnapshot[] = [];

    for (const row of rows) {
      const latest = await this.db("external_rate_limit_metrics")
        .where("provider_key", row.provider_key)
        .orderBy("recorded_at", "desc")
        .first();

      if (!latest) continue;

      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const agg = await this.db("external_rate_limit_metrics")
        .where("provider_key", row.provider_key)
        .where("recorded_at", ">=", since24h)
        .sum("requests_count as requests")
        .sum("throttled_count as throttled")
        .sum("burst_count as bursts")
        .first();

      const limitTotal = latest.limit_total as number | null;
      const limitRemaining = latest.limit_remaining as number | null;
      const usagePercent =
        limitTotal && limitRemaining != null
          ? Math.round(((limitTotal - limitRemaining) / limitTotal) * 100)
          : null;

      snapshots.push({
        providerKey: String(row.provider_key),
        requestsCount: Number(agg?.requests ?? 0),
        throttledCount: Number(agg?.throttled ?? 0),
        burstCount: Number(agg?.bursts ?? 0),
        limitRemaining,
        limitTotal,
        usagePercent,
        isThrottled: Boolean(latest.is_throttled),
        lastRecordedAt:
          latest.recorded_at instanceof Date
            ? latest.recorded_at.toISOString()
            : String(latest.recorded_at),
      });
    }

    return snapshots;
  }

  async getTrend(providerKey: string, hours = 24): Promise<RateLimitTrendPoint[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await this.db("external_rate_limit_metrics")
      .where("provider_key", providerKey)
      .where("recorded_at", ">=", since)
      .orderBy("recorded_at", "asc");

    const buckets = new Map<string, RateLimitTrendPoint>();

    for (const row of rows) {
      const ts = row.recorded_at instanceof Date ? row.recorded_at : new Date(String(row.recorded_at));
      const bucket = ts.toISOString().slice(0, 13) + ":00:00.000Z";
      const existing = buckets.get(bucket) ?? {
        bucket,
        requestsCount: 0,
        throttledCount: 0,
        burstCount: 0,
      };
      existing.requestsCount += Number(row.requests_count ?? 0);
      existing.throttledCount += Number(row.throttled_count ?? 0);
      existing.burstCount += Number(row.burst_count ?? 0);
      buckets.set(bucket, existing);
    }

    return Array.from(buckets.values());
  }

  async getAlerts(): Promise<RateLimitAlert[]> {
    const snapshots = await this.getProviderSnapshots();
    const thresholds = await this.db("external_rate_limit_alert_thresholds").select("*");
    const thresholdMap = new Map(thresholds.map((t) => [String(t.provider_key), t]));

    const alerts: RateLimitAlert[] = [];
    const now = new Date().toISOString();

    for (const snap of snapshots) {
      const threshold = thresholdMap.get(snap.providerKey) ?? {
        usage_warning_pct: 70,
        usage_critical_pct: 90,
        burst_warning_count: 5,
        enabled: true,
      };

      if (!threshold.enabled) continue;

      if (snap.isThrottled) {
        alerts.push({
          providerKey: snap.providerKey,
          severity: "critical",
          type: "throttle",
          message: `Provider ${snap.providerKey} is currently throttled`,
          timestamp: now,
        });
      }

      if (snap.usagePercent != null && snap.usagePercent >= Number(threshold.usage_critical_pct)) {
        alerts.push({
          providerKey: snap.providerKey,
          severity: "critical",
          type: "usage",
          message: `Usage at ${snap.usagePercent}% (critical threshold ${threshold.usage_critical_pct}%)`,
          timestamp: now,
        });
      } else if (snap.usagePercent != null && snap.usagePercent >= Number(threshold.usage_warning_pct)) {
        alerts.push({
          providerKey: snap.providerKey,
          severity: "warning",
          type: "usage",
          message: `Usage at ${snap.usagePercent}% (warning threshold ${threshold.usage_warning_pct}%)`,
          timestamp: now,
        });
      }

      if (snap.burstCount >= Number(threshold.burst_warning_count)) {
        alerts.push({
          providerKey: snap.providerKey,
          severity: "warning",
          type: "burst",
          message: `${snap.burstCount} burst events in the last 24h`,
          timestamp: now,
        });
      }
    }

    return alerts;
  }

  async setAlertThreshold(
    providerKey: string,
    thresholds: {
      usageWarningPct?: number;
      usageCriticalPct?: number;
      burstWarningCount?: number;
      enabled?: boolean;
    },
  ): Promise<void> {
    const existing = await this.db("external_rate_limit_alert_thresholds")
      .where("provider_key", providerKey)
      .first();

    const payload = {
      usage_warning_pct: thresholds.usageWarningPct ?? existing?.usage_warning_pct ?? 70,
      usage_critical_pct: thresholds.usageCriticalPct ?? existing?.usage_critical_pct ?? 90,
      burst_warning_count: thresholds.burstWarningCount ?? existing?.burst_warning_count ?? 5,
      enabled: thresholds.enabled ?? existing?.enabled ?? true,
      updated_at: new Date(),
    };

    if (existing) {
      await this.db("external_rate_limit_alert_thresholds")
        .where("provider_key", providerKey)
        .update(payload);
    } else {
      await this.db("external_rate_limit_alert_thresholds").insert({
        provider_key: providerKey,
        ...payload,
      });
    }
  }

  async exportMetrics(format: "json" = "json"): Promise<{
    format: string;
    exportedAt: string;
    providers: ProviderRateLimitSnapshot[];
    alerts: RateLimitAlert[];
  }> {
    const providers = await this.getProviderSnapshots();
    const alerts = await this.getAlerts();
    logger.info({ format, providerCount: providers.length }, "Exported external rate limit metrics");
    return {
      format,
      exportedAt: new Date().toISOString(),
      providers,
      alerts,
    };
  }
}

export const externalRateLimitMetricsService = new ExternalRateLimitMetricsService();
