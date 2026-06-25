import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export interface PerformanceBaseline {
  id: string;
  endpoint: string;
  method: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
  thresholdMs: number;
  measuredAt: string;
  createdAt: string;
}

export interface PerformanceSample {
  endpoint: string;
  method: string;
  durationMs: number;
  statusCode: number;
  sampledAt?: string;
}

export interface RegressionAlert {
  endpoint: string;
  method: string;
  currentP95Ms: number;
  baselineP95Ms: number;
  degradationPct: number;
  severity: "warning" | "critical";
}

export interface BaselineTrend {
  endpoint: string;
  method: string;
  history: Array<{ p95Ms: number; sampleCount: number; measuredAt: string }>;
}

const REGRESSION_WARNING_PCT = 20;
const REGRESSION_CRITICAL_PCT = 50;

export class PerformanceBaselineService {
  private db = getDatabase();

  async ensureTable(): Promise<void> {
    await this.db.raw(`
      CREATE TABLE IF NOT EXISTS performance_baselines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'GET',
        p50_ms NUMERIC NOT NULL,
        p95_ms NUMERIC NOT NULL,
        p99_ms NUMERIC NOT NULL,
        sample_count INTEGER NOT NULL,
        threshold_ms NUMERIC NOT NULL,
        measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_perf_baselines_endpoint ON performance_baselines (endpoint, method);
      CREATE INDEX IF NOT EXISTS idx_perf_baselines_measured_at ON performance_baselines (measured_at DESC);
    `);
  }

  async recordBaseline(samples: PerformanceSample[]): Promise<PerformanceBaseline[]> {
    if (samples.length === 0) return [];

    const grouped = new Map<string, number[]>();
    for (const s of samples) {
      const key = `${s.method.toUpperCase()}::${s.endpoint}`;
      const existing = grouped.get(key) ?? [];
      existing.push(s.durationMs);
      grouped.set(key, existing);
    }

    const results: PerformanceBaseline[] = [];

    for (const [key, durations] of grouped) {
      const [method, endpoint] = key.split("::");
      durations.sort((a, b) => a - b);

      const p50 = this.percentile(durations, 50);
      const p95 = this.percentile(durations, 95);
      const p99 = this.percentile(durations, 99);
      const threshold = p95 * 1.5;

      const row = await this.db.raw(
        `INSERT INTO performance_baselines
           (endpoint, method, p50_ms, p95_ms, p99_ms, sample_count, threshold_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING
           id,
           endpoint,
           method,
           p50_ms    AS "p50Ms",
           p95_ms    AS "p95Ms",
           p99_ms    AS "p99Ms",
           sample_count AS "sampleCount",
           threshold_ms AS "thresholdMs",
           measured_at  AS "measuredAt",
           created_at   AS "createdAt"`,
        [endpoint, method, p50, p95, p99, durations.length, threshold]
      );

      const baseline = row.rows[0] as PerformanceBaseline;
      results.push(baseline);
      logger.info({ endpoint, method, p50, p95, p99 }, "Performance baseline recorded");
    }

    return results;
  }

  async getLatestBaselines(): Promise<PerformanceBaseline[]> {
    const result = await this.db.raw(
      `SELECT DISTINCT ON (endpoint, method)
         id,
         endpoint,
         method,
         p50_ms    AS "p50Ms",
         p95_ms    AS "p95Ms",
         p99_ms    AS "p99Ms",
         sample_count AS "sampleCount",
         threshold_ms AS "thresholdMs",
         measured_at  AS "measuredAt",
         created_at   AS "createdAt"
       FROM performance_baselines
       ORDER BY endpoint, method, measured_at DESC`
    );
    return result.rows as unknown as PerformanceBaseline[];
  }

  async getBaselineForEndpoint(endpoint: string, method = "GET"): Promise<PerformanceBaseline | null> {
    const result = await this.db.raw(
      `SELECT
         id, endpoint, method,
         p50_ms AS "p50Ms", p95_ms AS "p95Ms", p99_ms AS "p99Ms",
         sample_count AS "sampleCount", threshold_ms AS "thresholdMs",
         measured_at AS "measuredAt", created_at AS "createdAt"
       FROM performance_baselines
       WHERE endpoint = ? AND method = ?
       ORDER BY measured_at DESC
       LIMIT 1`,
      [endpoint, method.toUpperCase()]
    );
    return (result.rows[0] as unknown as PerformanceBaseline) ?? null;
  }

  async detectRegressions(samples: PerformanceSample[]): Promise<RegressionAlert[]> {
    const alerts: RegressionAlert[] = [];
    const grouped = new Map<string, number[]>();

    for (const s of samples) {
      const key = `${s.method.toUpperCase()}::${s.endpoint}`;
      const arr = grouped.get(key) ?? [];
      arr.push(s.durationMs);
      grouped.set(key, arr);
    }

    for (const [key, durations] of grouped) {
      const [method, endpoint] = key.split("::");
      const baseline = await this.getBaselineForEndpoint(endpoint, method);
      if (!baseline) continue;

      durations.sort((a, b) => a - b);
      const currentP95 = this.percentile(durations, 95);
      const degradationPct = ((currentP95 - baseline.p95Ms) / baseline.p95Ms) * 100;

      if (degradationPct >= REGRESSION_WARNING_PCT) {
        alerts.push({
          endpoint,
          method,
          currentP95Ms: currentP95,
          baselineP95Ms: baseline.p95Ms,
          degradationPct: Math.round(degradationPct),
          severity: degradationPct >= REGRESSION_CRITICAL_PCT ? "critical" : "warning",
        });

        logger.warn(
          { endpoint, method, currentP95, baselineP95: baseline.p95Ms, degradationPct },
          "Performance regression detected"
        );
      }
    }

    return alerts;
  }

  async getTrend(endpoint: string, method = "GET", limit = 30): Promise<BaselineTrend> {
    const result = await this.db.raw(
      `SELECT
         p95_ms AS "p95Ms",
         sample_count AS "sampleCount",
         measured_at AS "measuredAt"
       FROM performance_baselines
       WHERE endpoint = ? AND method = ?
       ORDER BY measured_at DESC
       LIMIT ?`,
      [endpoint, method.toUpperCase(), limit]
    );

    return {
      endpoint,
      method: method.toUpperCase(),
      history: (result.rows as unknown as Array<{ p95Ms: number; sampleCount: number; measuredAt: string }>).reverse(),
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }
}

export const performanceBaselineService = new PerformanceBaselineService();
