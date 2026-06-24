import { getDatabase } from "../database/connection.js";
import { STALENESS_RULES, type StalenessRule } from "../config/stalenessRules.js";
import { CacheService, CacheTTL } from "../utils/cache.js";
import type { Asset } from "../database/types.js";
import { logger } from "../utils/logger.js";

export type AssetOverallStatus = "FRESH" | "DEGRADED" | "STALE";

export interface PerSourceFreshness {
  key: string; // rule key
  label: string;
  lastUpdated: string | null;
  ageMs: number | null;
  expectedIntervalMs: number;
  warnAfterMs: number;
  criticalAfterMs: number;
  status: "fresh" | "warning" | "stale" | "missing";
}

export interface AssetFreshnessDetail {
  asset: { id: string; symbol: string; name?: string };
  overallStatus: AssetOverallStatus;
  timestamp: string;
  sources: PerSourceFreshness[];
  worstSources: PerSourceFreshness[]; // sorted desc by age
}

export interface AssetFreshnessSummaryItem {
  assetId: string;
  symbol: string;
  name?: string;
  overallStatus: AssetOverallStatus;
  worstSources: { key: string; label: string; ageMs: number | null }[];
}

/**
 * Mapping which staleness rules are asset-scoped and which column contains the asset identifier.
 * Rules that don't map to an asset-level column are omitted (they are global sources).
 */
const ASSET_RULE_TO_COLUMN: Record<string, string | undefined> = {
  prices: "symbol",
  liquidity_snapshots: "symbol",
  health_scores: "symbol",
  bridge_volume_stats: "symbol",
  // verification_results does not include a symbol — skip per-asset evaluation
};

export class AssetFreshnessService {
  private readonly db = getDatabase();
  private readonly rules: StalenessRule[] = STALENESS_RULES;

  private generateSummaryCacheKey(): string {
    return CacheService.generateKey("asset-freshness", "summary:all");
  }

  private generateAssetCacheKey(symbol: string): string {
    return CacheService.generateKey("asset-freshness", `asset:${symbol}`);
  }

  async getSummary(options?: { bypassCache?: boolean }): Promise<AssetFreshnessSummaryItem[]> {
    const key = this.generateSummaryCacheKey();
    const items = await CacheService.getOrSet<AssetFreshnessSummaryItem[]>(
      key,
      () => this.computeSummary(),
      { ttl: CacheTTL.ANALYTICS, bypassCache: options?.bypassCache ?? false }
    );

    return items;
  }

  async getAssetDetail(symbol: string, options?: { bypassCache?: boolean }): Promise<AssetFreshnessDetail | null> {
    const key = this.generateAssetCacheKey(symbol);
    const detail = await CacheService.getOrSet<AssetFreshnessDetail | null>(
      key,
      () => this.computeAssetDetail(symbol),
      { ttl: CacheTTL.ANALYTICS, bypassCache: options?.bypassCache ?? false }
    );

    return detail;
  }

  private async computeSummary(): Promise<AssetFreshnessSummaryItem[]> {
    // Get active assets
    const assets: Asset[] = await this.db("assets").select("id", "symbol", "name").where({ is_active: true });

    const results: AssetFreshnessSummaryItem[] = [];

    // Parallelise per-asset computations but limit concurrency to avoid DB overload.
    const concurrency = 10;
    const queue: Promise<void>[] = [];

    for (const asset of assets) {
      const task = this.computeAssetDetail(asset.symbol).then((detail) => {
        if (!detail) return;
        results.push({
          assetId: asset.id,
          symbol: asset.symbol,
          name: asset.name ?? undefined,
          overallStatus: detail.overallStatus,
          worstSources: detail.worstSources.map((s) => ({ key: s.key, label: s.label, ageMs: s.ageMs })),
        });
      }).catch((err) => {
        logger.error({ err, asset: asset.symbol }, "Failed computing asset freshness summary for asset");
      });

      queue.push(task);
      if (queue.length >= concurrency) {
        await Promise.race(queue).catch(() => undefined);
        // Remove settled promises
        for (let i = queue.length - 1; i >= 0; i--) {
          if ((queue[i] as Promise<any>).finally) continue; // best-effort; we won't tightly control removal here
        }
        // keep queue size bounded
        while (queue.length > concurrency) queue.shift();
      }
    }

    await Promise.all(queue);

    // Sort results by severity (STALE > DEGRADED > FRESH) then symbol
    const rank = (s: AssetOverallStatus) => (s === "STALE" ? 0 : s === "DEGRADED" ? 1 : 2);
    results.sort((a, b) => rank(a.overallStatus) - rank(b.overallStatus) || a.symbol.localeCompare(b.symbol));

    return results;
  }

  private async computeAssetDetail(symbol: string): Promise<AssetFreshnessDetail | null> {
    // Validate asset exists
    const asset = await this.db("assets").select("id", "symbol", "name").where({ symbol }).first();
    if (!asset) return null;

    const sourceSnapshots: PerSourceFreshness[] = [];

    for (const rule of this.rules) {
      const column = ASSET_RULE_TO_COLUMN[rule.key];
      if (!column) {
        // Skip rules that are not asset-scoped
        continue;
      }

      try {
        const row = await this.db(rule.table).where(column, symbol).max(`${rule.timeColumn} as latest`).first();
        const latestRaw = row?.latest ?? null;
        const latest = latestRaw ? new Date(latestRaw) : null;
        const ageMs = latest ? Date.now() - latest.getTime() : null;
        const status = this.evaluateStatus(rule, ageMs);

        sourceSnapshots.push({
          key: rule.key,
          label: rule.label,
          lastUpdated: latest ? latest.toISOString() : null,
          ageMs,
          expectedIntervalMs: rule.expectedIntervalMs,
          warnAfterMs: rule.warnAfterMs,
          criticalAfterMs: rule.criticalAfterMs,
          status,
        });
      } catch (error) {
        logger.error({ error, rule: rule.key, asset: symbol }, "Error querying recent timestamp for asset-source");
        sourceSnapshots.push({
          key: rule.key,
          label: rule.label,
          lastUpdated: null,
          ageMs: null,
          expectedIntervalMs: rule.expectedIntervalMs,
          warnAfterMs: rule.warnAfterMs,
          criticalAfterMs: rule.criticalAfterMs,
          status: "missing",
        });
      }
    }

    // Derive overall status
    const overall: AssetOverallStatus = this.rollupAssetStatus(sourceSnapshots);

    // Worst performing sources: sort by age descending (nulls last), take top 3
    const worst = [...sourceSnapshots]
      .sort((a, b) => {
        if (a.ageMs === null && b.ageMs === null) return 0;
        if (a.ageMs === null) return 1;
        if (b.ageMs === null) return -1;
        return (b.ageMs as number) - (a.ageMs as number);
      })
      .slice(0, 3);

    return {
      asset: { id: asset.id, symbol: asset.symbol, name: asset.name ?? undefined },
      overallStatus: overall,
      timestamp: new Date().toISOString(),
      sources: sourceSnapshots,
      worstSources: worst,
    };
  }

  private evaluateStatus(rule: StalenessRule, ageMs: number | null): "fresh" | "warning" | "stale" | "missing" {
    if (ageMs === null) return "missing";
    if (ageMs <= rule.warnAfterMs) return "fresh";
    if (ageMs <= rule.criticalAfterMs) return "warning";
    return "stale";
  }

  private rollupAssetStatus(sources: PerSourceFreshness[]): AssetOverallStatus {
    if (sources.length === 0) return "DEGRADED";

    // If any critical source (sourceType === 'source') has status 'stale', mark overall STALE
    const criticalRuleKeys = this.rules.filter((r) => r.sourceType === "source").map((r) => r.key);
    const hasCriticalStale = sources.some((s) => criticalRuleKeys.includes(s.key) && s.status === "stale");
    if (hasCriticalStale) return "STALE";

    // If any source is missing or in warning state, consider DEGRADED
    const anyMissingOrWarn = sources.some((s) => s.status === "missing" || s.status === "warning");
    if (anyMissingOrWarn) return "DEGRADED";

    return "FRESH";
  }
}

export const assetFreshnessService = new AssetFreshnessService();
