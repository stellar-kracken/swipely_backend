import { BridgeService } from "./bridge.service.js";
import { HealthScoreHistoryService } from "./healthScoreHistory.service.js";
import { redis } from "../utils/redis.js";
import { logger } from "../utils/logger.js";

const CACHE_KEY = "bw:bridge-health-snapshot";
const CACHE_TTL_SEC = 30;

export interface BridgeHealthSnapshot {
  timestamp: string;
  overallStatus: "healthy" | "degraded" | "down";
  assetCoverage: {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
  };
  bridges: Array<{
    name: string;
    status: string;
    totalValueLocked: number;
    mismatchPercentage: number;
    lastChecked: string;
  }>;
  trendSummary: {
    direction: "improving" | "stable" | "deteriorating";
    averageScore: number | null;
    windowHours: number;
  };
  cached: boolean;
}

export class BridgeHealthSnapshotService {
  private bridgeService = new BridgeService();
  private healthScoreHistory = new HealthScoreHistoryService();

  async getSnapshot(options?: { bypassCache?: boolean }): Promise<BridgeHealthSnapshot> {
    if (!options?.bypassCache) {
      const cached = await redis.get(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as BridgeHealthSnapshot;
        return { ...parsed, cached: true };
      }
    }

    const snapshot = await this.buildSnapshot();
    await redis.setex(CACHE_KEY, CACHE_TTL_SEC, JSON.stringify({ ...snapshot, cached: false }));
    return snapshot;
  }

  async invalidateCache(): Promise<void> {
    await redis.del(CACHE_KEY);
  }

  private async buildSnapshot(): Promise<BridgeHealthSnapshot> {
    const { bridges } = await this.bridgeService.getAllBridgeStatuses();

    const coverage = { total: bridges.length, healthy: 0, degraded: 0, down: 0 };
    for (const b of bridges) {
      if (b.status === "healthy") coverage.healthy++;
      else if (b.status === "down") coverage.down++;
      else coverage.degraded++;
    }

    let overallStatus: BridgeHealthSnapshot["overallStatus"] = "healthy";
    if (coverage.down > 0) overallStatus = "down";
    else if (coverage.degraded > 0) overallStatus = "degraded";

    const trends = await Promise.all(
      bridges.slice(0, 5).map((b) => this.healthScoreHistory.getTrend(b.name.toUpperCase(), 24)),
    );
    const validTrends = trends.filter((t): t is NonNullable<typeof t> => t !== null);

    let trendDirection: BridgeHealthSnapshot["trendSummary"]["direction"] = "stable";
    if (validTrends.length > 0) {
      const improving = validTrends.filter((t) => t.direction === "improving").length;
      const deteriorating = validTrends.filter((t) => t.direction === "deteriorating").length;
      if (improving > deteriorating) trendDirection = "improving";
      else if (deteriorating > improving) trendDirection = "deteriorating";
    }

    const averageScore =
      validTrends.length > 0
        ? Math.round(validTrends.reduce((sum, t) => sum + t.current, 0) / validTrends.length)
        : null;

    return {
      timestamp: new Date().toISOString(),
      overallStatus,
      assetCoverage: coverage,
      bridges: bridges.map((b) => ({
        name: b.name,
        status: b.status,
        totalValueLocked: b.totalValueLocked,
        mismatchPercentage: b.mismatchPercentage,
        lastChecked: b.lastChecked,
      })),
      trendSummary: {
        direction: trendDirection,
        averageScore,
        windowHours: 24,
      },
      cached: false,
    };
  }
}

export const bridgeHealthSnapshotService = new BridgeHealthSnapshotService();
