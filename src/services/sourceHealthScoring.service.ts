import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

// Scoring weights — must sum to 1.0
const WEIGHTS = {
  uptime: 0.35,
  latency: 0.30,
  accuracy: 0.20,
  responsiveness: 0.15,
} as const;

// Latency thresholds (ms)
const LATENCY_EXCELLENT_MS = 150;
const LATENCY_POOR_MS = 5000;

// Overall-score alert thresholds
const THRESHOLD_CRITICAL = 40;
const THRESHOLD_WARNING = 65;

export type SourceHealthGrade = "A" | "B" | "C" | "D" | "F";
export type SourceAlertState = "ok" | "warning" | "critical";
export type TrendDirection = "improving" | "degrading" | "stable" | "insufficient_data";

export interface SourceContributingFactors {
  uptimeRatio: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  totalChecks: number;
  failureCount: number;
  failureRate: number;
  windowHours: number;
}

export interface SourceThresholdViolation {
  factor: "uptime" | "latency" | "accuracy" | "responsiveness" | "overall";
  score: number;
  threshold: number;
  severity: "warning" | "critical";
  message: string;
}

export interface SourceHealthScore {
  id: string;
  sourceKey: string;
  displayName: string;
  category: string;
  overallScore: number;
  uptimeScore: number;
  latencyScore: number;
  accuracyScore: number;
  responsivenessScore: number;
  grade: SourceHealthGrade;
  alertState: SourceAlertState;
  contributingFactors: SourceContributingFactors;
  thresholdViolations: SourceThresholdViolation[];
  sampleCount: number;
  computedAt: string;
  updatedAt: string;
}

export interface SourceHealthHistoryEntry {
  id: string;
  sourceKey: string;
  overallScore: number;
  uptimeScore: number;
  latencyScore: number;
  accuracyScore: number;
  responsivenessScore: number;
  grade: string;
  alertState: string;
  sampleCount: number;
  computedAt: string;
}

export interface SourceHealthTrend {
  sourceKey: string;
  trendDirection: TrendDirection;
  scoreDelta: number | null;
  averageScore7d: number | null;
  averageScore24h: number | null;
  minScore7d: number | null;
  maxScore7d: number | null;
  recentHistory: SourceHealthHistoryEntry[];
}

export interface ListSourceScoresOptions {
  category?: string;
  alertState?: SourceAlertState;
  minScore?: number;
  maxScore?: number;
  limit?: number;
  offset?: number;
}

// ─── Pure scoring functions ─────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function scoreUptime(ratio: number): number {
  return r2(Math.min(100, Math.max(0, ratio * 100)));
}

function scoreLatency(avgMs: number | null): number {
  if (avgMs === null) return 75;
  if (avgMs <= LATENCY_EXCELLENT_MS) return 100;
  if (avgMs >= LATENCY_POOR_MS) return 0;
  const fraction = (avgMs - LATENCY_EXCELLENT_MS) / (LATENCY_POOR_MS - LATENCY_EXCELLENT_MS);
  return r2((1 - fraction) * 100);
}

function scoreAccuracy(failures: number, total: number): number {
  if (total === 0) return 75;
  return r2(Math.max(0, (1 - failures / total) * 100));
}

function scoreResponsiveness(avgMs: number | null, p95Ms: number | null): number {
  if (avgMs === null || p95Ms === null || avgMs === 0) return 75;
  const ratio = p95Ms / avgMs;
  if (ratio <= 1.5) return 100;
  if (ratio >= 6) return 0;
  return r2(((6 - ratio) / (6 - 1.5)) * 100);
}

function overallScore(uptime: number, latency: number, accuracy: number, responsiveness: number): number {
  return r2(
    uptime * WEIGHTS.uptime +
      latency * WEIGHTS.latency +
      accuracy * WEIGHTS.accuracy +
      responsiveness * WEIGHTS.responsiveness,
  );
}

function toGrade(score: number): SourceHealthGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function toAlertState(score: number): SourceAlertState {
  if (score < THRESHOLD_CRITICAL) return "critical";
  if (score < THRESHOLD_WARNING) return "warning";
  return "ok";
}

function detectViolations(
  overall: number,
  uptime: number,
  latency: number,
  accuracy: number,
  responsiveness: number,
): SourceThresholdViolation[] {
  const out: SourceThresholdViolation[] = [];

  if (overall < THRESHOLD_CRITICAL) {
    out.push({
      factor: "overall",
      score: overall,
      threshold: THRESHOLD_CRITICAL,
      severity: "critical",
      message: `Overall score ${overall.toFixed(1)} is critically low (threshold: ${THRESHOLD_CRITICAL})`,
    });
  } else if (overall < THRESHOLD_WARNING) {
    out.push({
      factor: "overall",
      score: overall,
      threshold: THRESHOLD_WARNING,
      severity: "warning",
      message: `Overall score ${overall.toFixed(1)} is below warning threshold (${THRESHOLD_WARNING})`,
    });
  }

  if (uptime < 80) {
    out.push({
      factor: "uptime",
      score: uptime,
      threshold: 80,
      severity: uptime < 60 ? "critical" : "warning",
      message: `Uptime score ${uptime.toFixed(1)} is below acceptable level (80)`,
    });
  }

  if (latency < 50) {
    out.push({
      factor: "latency",
      score: latency,
      threshold: 50,
      severity: latency < 25 ? "critical" : "warning",
      message: `Latency score ${latency.toFixed(1)} indicates elevated response times`,
    });
  }

  if (accuracy < 85) {
    out.push({
      factor: "accuracy",
      score: accuracy,
      threshold: 85,
      severity: accuracy < 65 ? "critical" : "warning",
      message: `Accuracy score ${accuracy.toFixed(1)} reflects elevated failure rate`,
    });
  }

  if (responsiveness < 50) {
    out.push({
      factor: "responsiveness",
      score: responsiveness,
      threshold: 50,
      severity: "warning",
      message: `Responsiveness score ${responsiveness.toFixed(1)} shows high P95/avg latency variance`,
    });
  }

  return out;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (value !== null && typeof value === "object") return value as T;
  return fallback;
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// ─── Service ────────────────────────────────────────────────────────────────

export class SourceHealthScoringService {
  private readonly db = getDatabase();

  async computeAndStore(windowHours = 24): Promise<SourceHealthScore[]> {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const [checks, dependencies] = await Promise.all([
      this.db("external_dependency_checks").where("checked_at", ">=", cutoff).orderBy("checked_at", "desc"),
      this.db("external_dependencies").select("*"),
    ]);

    const depMap = new Map<string, Record<string, unknown>>();
    for (const dep of dependencies as Record<string, unknown>[]) {
      depMap.set(String(dep.provider_key), dep);
    }

    const bySource = new Map<string, Record<string, unknown>[]>();
    for (const dep of dependencies as Record<string, unknown>[]) {
      bySource.set(String(dep.provider_key), []);
    }
    for (const row of checks as Record<string, unknown>[]) {
      const key = String(row.provider_key);
      const bucket = bySource.get(key) ?? [];
      bucket.push(row);
      bySource.set(key, bucket);
    }

    const scores: SourceHealthScore[] = [];

    for (const [sourceKey, sourceChecks] of bySource.entries()) {
      const dep = depMap.get(sourceKey);
      const displayName = dep ? String(dep.display_name ?? sourceKey) : sourceKey;
      const category = dep ? String(dep.category ?? "unknown") : "unknown";

      const totalChecks = sourceChecks.length;
      const healthyChecks = sourceChecks.filter((r) => String(r.status) === "healthy").length;
      const failureCount = sourceChecks.filter((r) => {
        const s = String(r.status);
        return s === "down" || s === "degraded";
      }).length;

      const latencySamples = (sourceChecks as Record<string, unknown>[])
        .map((r) => (r.latency_ms === null || r.latency_ms === undefined ? null : Number(r.latency_ms)))
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);

      const avgLatencyMs =
        latencySamples.length > 0
          ? r2(latencySamples.reduce((s, v) => s + v, 0) / latencySamples.length)
          : null;

      const p95LatencyMs =
        latencySamples.length > 0
          ? latencySamples[Math.min(latencySamples.length - 1, Math.ceil(latencySamples.length * 0.95) - 1)]
          : null;

      const uptimeRatio = totalChecks === 0 ? 0 : r2(healthyChecks / totalChecks);
      const failureRate = totalChecks === 0 ? 0 : r2(failureCount / totalChecks);

      const uptimeS = scoreUptime(uptimeRatio);
      const latencyS = scoreLatency(avgLatencyMs);
      const accuracyS = scoreAccuracy(failureCount, totalChecks);
      const responsivenessS = scoreResponsiveness(avgLatencyMs, p95LatencyMs);
      const overall = overallScore(uptimeS, latencyS, accuracyS, responsivenessS);
      const grade = toGrade(overall);
      const alertState = toAlertState(overall);
      const violations = detectViolations(overall, uptimeS, latencyS, accuracyS, responsivenessS);

      const factors: SourceContributingFactors = {
        uptimeRatio,
        avgLatencyMs,
        p95LatencyMs,
        totalChecks,
        failureCount,
        failureRate,
        windowHours,
      };

      const now = new Date();

      const [row] = await this.db("source_health_scores")
        .insert({
          source_key: sourceKey,
          display_name: displayName,
          category,
          overall_score: overall,
          uptime_score: uptimeS,
          latency_score: latencyS,
          accuracy_score: accuracyS,
          responsiveness_score: responsivenessS,
          grade,
          alert_state: alertState,
          contributing_factors: JSON.stringify(factors),
          threshold_violations: JSON.stringify(violations),
          sample_count: totalChecks,
          computed_at: now,
          updated_at: now,
        })
        .onConflict("source_key")
        .merge([
          "display_name",
          "category",
          "overall_score",
          "uptime_score",
          "latency_score",
          "accuracy_score",
          "responsiveness_score",
          "grade",
          "alert_state",
          "contributing_factors",
          "threshold_violations",
          "sample_count",
          "computed_at",
          "updated_at",
        ])
        .returning("*");

      await this.db("source_health_score_history").insert({
        source_key: sourceKey,
        overall_score: overall,
        uptime_score: uptimeS,
        latency_score: latencyS,
        accuracy_score: accuracyS,
        responsiveness_score: responsivenessS,
        grade,
        alert_state: alertState,
        sample_count: totalChecks,
        computed_at: now,
      });

      if (alertState !== "ok") {
        logger.warn(
          { sourceKey, alertState, overallScore: overall, violations: violations.length },
          "Source health score threshold alert",
        );
      }

      scores.push(this.mapRow(row as Record<string, unknown>));
    }

    return scores;
  }

  async listScores(options: ListSourceScoresOptions = {}): Promise<{ scores: SourceHealthScore[]; total: number }> {
    let query = this.db("source_health_scores");
    if (options.category) query = query.where("category", options.category);
    if (options.alertState) query = query.where("alert_state", options.alertState);
    if (options.minScore !== undefined) query = query.where("overall_score", ">=", options.minScore);
    if (options.maxScore !== undefined) query = query.where("overall_score", "<=", options.maxScore);

    const countRow = await query.clone().count("id as count").first();
    const total = Number((countRow as Record<string, unknown>)?.count ?? 0);

    const rows = await query
      .orderBy("overall_score", "asc")
      .limit(options.limit ?? 100)
      .offset(options.offset ?? 0);

    return { scores: (rows as Record<string, unknown>[]).map((r) => this.mapRow(r)), total };
  }

  async getScore(sourceKey: string): Promise<SourceHealthScore | null> {
    const row = await this.db("source_health_scores").where("source_key", sourceKey).first();
    return row ? this.mapRow(row as Record<string, unknown>) : null;
  }

  async getHistory(sourceKey: string, opts: { limit?: number; since?: Date } = {}): Promise<SourceHealthHistoryEntry[]> {
    let query = this.db("source_health_score_history").where("source_key", sourceKey);
    if (opts.since) query = query.where("computed_at", ">=", opts.since);
    const rows = await query.orderBy("computed_at", "desc").limit(opts.limit ?? 200);
    return (rows as Record<string, unknown>[]).map((r) => this.mapHistoryRow(r));
  }

  async getTrend(sourceKey: string): Promise<SourceHealthTrend> {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const history7d = await this.getHistory(sourceKey, { since: since7d });
    const history24h = history7d.filter((e) => new Date(e.computedAt) >= since24h);

    const avg = (items: SourceHealthHistoryEntry[]): number | null =>
      items.length ? r2(items.reduce((s, e) => s + e.overallScore, 0) / items.length) : null;

    const averageScore7d = avg(history7d);
    const averageScore24h = avg(history24h);

    const minScore7d = history7d.length ? Math.min(...history7d.map((e) => e.overallScore)) : null;
    const maxScore7d = history7d.length ? Math.max(...history7d.map((e) => e.overallScore)) : null;

    let scoreDelta: number | null = null;
    let trendDirection: TrendDirection = "insufficient_data";

    if (averageScore7d !== null && averageScore24h !== null) {
      scoreDelta = r2(averageScore24h - averageScore7d);
      if (Math.abs(scoreDelta) < 2) trendDirection = "stable";
      else trendDirection = scoreDelta > 0 ? "improving" : "degrading";
    }

    return {
      sourceKey,
      trendDirection,
      scoreDelta,
      averageScore7d,
      averageScore24h,
      minScore7d,
      maxScore7d,
      recentHistory: history7d.slice(0, 48),
    };
  }

  async pruneHistory(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const deleted = await this.db("source_health_score_history").where("computed_at", "<", cutoff).delete();
    return Number(deleted);
  }

  private mapRow(row: Record<string, unknown>): SourceHealthScore {
    return {
      id: String(row.id),
      sourceKey: String(row.source_key),
      displayName: String(row.display_name ?? ""),
      category: String(row.category ?? "unknown"),
      overallScore: Number(row.overall_score),
      uptimeScore: Number(row.uptime_score),
      latencyScore: Number(row.latency_score),
      accuracyScore: Number(row.accuracy_score),
      responsivenessScore: Number(row.responsiveness_score),
      grade: String(row.grade) as SourceHealthGrade,
      alertState: String(row.alert_state) as SourceAlertState,
      contributingFactors: parseJson<SourceContributingFactors>(row.contributing_factors, {
        uptimeRatio: 0,
        avgLatencyMs: null,
        p95LatencyMs: null,
        totalChecks: 0,
        failureCount: 0,
        failureRate: 0,
        windowHours: 24,
      }),
      thresholdViolations: parseJson<SourceThresholdViolation[]>(row.threshold_violations, []),
      sampleCount: Number(row.sample_count ?? 0),
      computedAt: isoTimestamp(row.computed_at),
      updatedAt: isoTimestamp(row.updated_at),
    };
  }

  private mapHistoryRow(row: Record<string, unknown>): SourceHealthHistoryEntry {
    return {
      id: String(row.id),
      sourceKey: String(row.source_key),
      overallScore: Number(row.overall_score),
      uptimeScore: Number(row.uptime_score),
      latencyScore: Number(row.latency_score),
      accuracyScore: Number(row.accuracy_score),
      responsivenessScore: Number(row.responsiveness_score),
      grade: String(row.grade),
      alertState: String(row.alert_state),
      sampleCount: Number(row.sample_count ?? 0),
      computedAt: isoTimestamp(row.computed_at),
    };
  }
}

export const sourceHealthScoringService = new SourceHealthScoringService();
