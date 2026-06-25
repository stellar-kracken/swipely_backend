import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export type MetricGranularity = "hourly" | "daily" | "weekly";

const GRANULARITY_ORDER: MetricGranularity[] = ["hourly", "daily", "weekly"];

const GRANULARITY_CONFIG: Record<
  MetricGranularity,
  { truncUnit: "hour" | "day" | "week"; sourceGranularity: "raw" | MetricGranularity }
> = {
  hourly: { truncUnit: "hour", sourceGranularity: "raw" },
  daily: { truncUnit: "day", sourceGranularity: "hourly" },
  weekly: { truncUnit: "week", sourceGranularity: "daily" },
};

export interface MetricDataPoint {
  metricKey: string;
  value: number;
  tags?: Record<string, unknown>;
  recordedAt?: string;
}

export interface MetricRollup {
  id: string;
  metricKey: string;
  granularity: MetricGranularity;
  windowStart: string;
  windowEnd: string;
  sampleCount: number;
  sumValue: number;
  minValue: number;
  maxValue: number;
  avgValue: number;
  p50Value: number;
  p95Value: number;
  p99Value: number;
  tags: Record<string, unknown>;
  createdAt: string;
}

export interface RollupQuery {
  metricKey?: string;
  granularity: MetricGranularity;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface RetentionPolicy {
  granularity: "raw" | MetricGranularity;
  retentionDays: number;
  updatedAt: string;
}

const MAX_INGEST_BATCH = 1000;
const MAX_QUERY_LIMIT = 5000;

export class MetricsAggregationService {
  private db = getDatabase();

  async ingest(points: MetricDataPoint[]): Promise<number> {
    if (points.length === 0) return 0;
    if (points.length > MAX_INGEST_BATCH) {
      throw new Error(`Cannot ingest more than ${MAX_INGEST_BATCH} points per request`);
    }

    const rows = points.map((p) => ({
      metric_key: p.metricKey,
      value: p.value,
      tags: JSON.stringify(p.tags ?? {}),
      recorded_at: p.recordedAt ? new Date(p.recordedAt) : new Date(),
    }));

    await this.db("metric_data_points").insert(rows);
    logger.info({ count: rows.length }, "Ingested raw metric data points");
    return rows.length;
  }

  /**
   * Rolls up the given granularity from its source (raw data for "hourly",
   * the previous granularity's rollups for "daily"/"weekly"). Only windows
   * that have fully elapsed are rolled up, and rows are upserted so reruns
   * are idempotent.
   */
  async runRollup(granularity: MetricGranularity): Promise<number> {
    const { truncUnit, sourceGranularity } = GRANULARITY_CONFIG[granularity];

    const groups =
      sourceGranularity === "raw"
        ? await this.aggregateFromRaw(truncUnit)
        : await this.aggregateFromRollups(sourceGranularity, truncUnit);

    if (groups.length === 0) return 0;

    for (const group of groups) {
      await this.db("metric_rollups")
        .insert({
          metric_key: group.metricKey,
          granularity,
          window_start: group.windowStart,
          window_end: group.windowEnd,
          sample_count: group.sampleCount,
          sum_value: group.sumValue,
          min_value: group.minValue,
          max_value: group.maxValue,
          avg_value: group.avgValue,
          p50_value: group.p50Value,
          p95_value: group.p95Value,
          p99_value: group.p99Value,
          tags: JSON.stringify({}),
        })
        .onConflict(["metric_key", "granularity", "window_start"])
        .merge({
          window_end: group.windowEnd,
          sample_count: group.sampleCount,
          sum_value: group.sumValue,
          min_value: group.minValue,
          max_value: group.maxValue,
          avg_value: group.avgValue,
          p50_value: group.p50Value,
          p95_value: group.p95Value,
          p99_value: group.p99Value,
        });
    }

    logger.info({ granularity, windows: groups.length }, "Metrics rollup completed");
    return groups.length;
  }

  async runAllRollups(): Promise<Record<MetricGranularity, number>> {
    const results: Record<MetricGranularity, number> = { hourly: 0, daily: 0, weekly: 0 };
    for (const granularity of GRANULARITY_ORDER) {
      results[granularity] = await this.runRollup(granularity);
    }
    return results;
  }

  async getRollups(query: RollupQuery): Promise<MetricRollup[]> {
    const limit = Math.min(query.limit ?? 100, MAX_QUERY_LIMIT);

    let q = this.db("metric_rollups").where("granularity", query.granularity);
    if (query.metricKey) q = q.where("metric_key", query.metricKey);
    if (query.from) q = q.where("window_start", ">=", query.from);
    if (query.to) q = q.where("window_start", "<=", query.to);

    const rows = await q.orderBy("window_start", "desc").limit(limit);
    return rows.map((row) => this.mapRollup(row));
  }

  async exportRollups(query: RollupQuery, format: "json" | "csv"): Promise<string> {
    const rollups = await this.getRollups({ ...query, limit: query.limit ?? MAX_QUERY_LIMIT });

    if (format === "json") {
      return JSON.stringify(rollups, null, 2);
    }

    const header = [
      "metricKey", "granularity", "windowStart", "windowEnd", "sampleCount",
      "sumValue", "minValue", "maxValue", "avgValue", "p50Value", "p95Value", "p99Value",
    ].join(",");

    const rows = rollups.map((r) =>
      [
        r.metricKey, r.granularity, r.windowStart, r.windowEnd, r.sampleCount,
        r.sumValue, r.minValue, r.maxValue, r.avgValue, r.p50Value, r.p95Value, r.p99Value,
      ].join(",")
    );

    return [header, ...rows].join("\n");
  }

  async listRetentionPolicies(): Promise<RetentionPolicy[]> {
    const rows = await this.db("metric_retention_policies").select("*").orderBy("granularity");
    return rows.map((row) => ({
      granularity: row.granularity,
      retentionDays: Number(row.retention_days),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async setRetentionPolicy(granularity: string, retentionDays: number): Promise<RetentionPolicy> {
    if (retentionDays <= 0) {
      throw new Error("retentionDays must be a positive integer");
    }

    const [row] = await this.db("metric_retention_policies")
      .insert({ granularity, retention_days: retentionDays, updated_at: new Date() })
      .onConflict("granularity")
      .merge({ retention_days: retentionDays, updated_at: new Date() })
      .returning("*");

    return {
      granularity: row.granularity,
      retentionDays: Number(row.retention_days),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  /**
   * Deletes raw points and rollup windows older than their configured
   * retention policy. Returns the number of rows deleted per granularity.
   */
  async applyRetentionPolicies(): Promise<Record<string, number>> {
    const policies = await this.listRetentionPolicies();
    const deleted: Record<string, number> = {};

    for (const policy of policies) {
      const cutoff = new Date(Date.now() - policy.retentionDays * 86_400_000);

      if (policy.granularity === "raw") {
        deleted.raw = await this.db("metric_data_points").where("recorded_at", "<", cutoff).delete();
      } else {
        deleted[policy.granularity] = await this.db("metric_rollups")
          .where("granularity", policy.granularity)
          .where("window_start", "<", cutoff)
          .delete();
      }
    }

    logger.info({ deleted }, "Metric retention policies applied");
    return deleted;
  }

  private async aggregateFromRaw(truncUnit: "hour" | "day" | "week"): Promise<
    Array<{
      metricKey: string;
      windowStart: Date;
      windowEnd: Date;
      sampleCount: number;
      sumValue: number;
      minValue: number;
      maxValue: number;
      avgValue: number;
      p50Value: number;
      p95Value: number;
      p99Value: number;
    }>
  > {
    const result = await this.db.raw(
      `
      SELECT
        metric_key AS "metricKey",
        date_trunc(?, recorded_at) AS "windowStart",
        date_trunc(?, recorded_at) + ?::interval AS "windowEnd",
        COUNT(*)::int AS "sampleCount",
        SUM(value) AS "sumValue",
        MIN(value) AS "minValue",
        MAX(value) AS "maxValue",
        AVG(value) AS "avgValue",
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) AS "p50Value",
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value) AS "p95Value",
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value) AS "p99Value"
      FROM metric_data_points
      WHERE recorded_at < date_trunc(?, now())
      GROUP BY metric_key, date_trunc(?, recorded_at)
      `,
      [truncUnit, truncUnit, `1 ${truncUnit}`, truncUnit, truncUnit]
    );

    return result.rows.map((row: Record<string, unknown>) => this.normalizeAggregateRow(row));
  }

  private async aggregateFromRollups(
    sourceGranularity: MetricGranularity,
    truncUnit: "hour" | "day" | "week"
  ): Promise<
    Array<{
      metricKey: string;
      windowStart: Date;
      windowEnd: Date;
      sampleCount: number;
      sumValue: number;
      minValue: number;
      maxValue: number;
      avgValue: number;
      p50Value: number;
      p95Value: number;
      p99Value: number;
    }>
  > {
    // Higher-granularity rollups are built from already-aggregated rows, so exact
    // percentiles are no longer available; we approximate with a sample-weighted
    // average of the constituent percentiles, which is sufficient for trend reporting.
    const result = await this.db.raw(
      `
      SELECT
        metric_key AS "metricKey",
        date_trunc(?, window_start) AS "windowStart",
        date_trunc(?, window_start) + ?::interval AS "windowEnd",
        SUM(sample_count)::int AS "sampleCount",
        SUM(sum_value) AS "sumValue",
        MIN(min_value) AS "minValue",
        MAX(max_value) AS "maxValue",
        CASE WHEN SUM(sample_count) = 0 THEN 0 ELSE SUM(sum_value) / SUM(sample_count) END AS "avgValue",
        CASE WHEN SUM(sample_count) = 0 THEN 0 ELSE SUM(p50_value * sample_count) / SUM(sample_count) END AS "p50Value",
        CASE WHEN SUM(sample_count) = 0 THEN 0 ELSE SUM(p95_value * sample_count) / SUM(sample_count) END AS "p95Value",
        MAX(p99_value) AS "p99Value"
      FROM metric_rollups
      WHERE granularity = ? AND window_start < date_trunc(?, now())
      GROUP BY metric_key, date_trunc(?, window_start)
      `,
      [truncUnit, truncUnit, `1 ${truncUnit}`, sourceGranularity, truncUnit, truncUnit]
    );

    return result.rows.map((row: Record<string, unknown>) => this.normalizeAggregateRow(row));
  }

  private normalizeAggregateRow(row: Record<string, unknown>) {
    return {
      metricKey: String(row.metricKey),
      windowStart: new Date(String(row.windowStart)),
      windowEnd: new Date(String(row.windowEnd)),
      sampleCount: Number(row.sampleCount),
      sumValue: Number(row.sumValue),
      minValue: Number(row.minValue),
      maxValue: Number(row.maxValue),
      avgValue: Number(row.avgValue),
      p50Value: Number(row.p50Value),
      p95Value: Number(row.p95Value),
      p99Value: Number(row.p99Value),
    };
  }

  private mapRollup(row: Record<string, unknown>): MetricRollup {
    return {
      id: String(row.id),
      metricKey: String(row.metric_key),
      granularity: row.granularity as MetricGranularity,
      windowStart: new Date(String(row.window_start)).toISOString(),
      windowEnd: new Date(String(row.window_end)).toISOString(),
      sampleCount: Number(row.sample_count),
      sumValue: Number(row.sum_value),
      minValue: Number(row.min_value),
      maxValue: Number(row.max_value),
      avgValue: Number(row.avg_value),
      p50Value: Number(row.p50_value),
      p95Value: Number(row.p95_value),
      p99Value: Number(row.p99_value),
      tags: typeof row.tags === "string" ? JSON.parse(row.tags) : (row.tags as Record<string, unknown>) ?? {},
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }
}

export const metricsAggregationService = new MetricsAggregationService();
