export type StalenessSourceType = "source" | "derived";

export interface StalenessRule {
  key: string;
  label: string;
  description: string;
  table: string;
  timeColumn: string;
  sourceType: StalenessSourceType;
  expectedIntervalMs: number;
  warnAfterMs: number;
  criticalAfterMs: number;
}

const minutes = (value: number) => value * 60 * 1000;
const hours = (value: number) => minutes(60) * value;

export const STALENESS_RULES: StalenessRule[] = [
  {
    key: "prices",
    label: "Price observations",
    description: "Aggregated price samples stored in the prices hypertable.",
    table: "prices",
    timeColumn: "time",
    sourceType: "source",
    expectedIntervalMs: 30_000,
    warnAfterMs: minutes(2),
    criticalAfterMs: minutes(5),
  },
  {
    key: "liquidity_snapshots",
    label: "Liquidity snapshots",
    description: "Per-DEX liquidity snapshots used for analytics rollups.",
    table: "liquidity_snapshots",
    timeColumn: "time",
    sourceType: "source",
    expectedIntervalMs: minutes(5),
    warnAfterMs: minutes(15),
    criticalAfterMs: minutes(30),
  },
  {
    key: "health_scores",
    label: "Health scores",
    description: "Composite asset health scores produced by scheduled jobs.",
    table: "health_scores",
    timeColumn: "time",
    sourceType: "derived",
    expectedIntervalMs: minutes(5),
    warnAfterMs: minutes(15),
    criticalAfterMs: minutes(30),
  },
  {
    key: "verification_results",
    label: "Bridge verification results",
    description: "Supply verification results captured for bridged assets.",
    table: "verification_results",
    timeColumn: "verified_at",
    sourceType: "source",
    expectedIntervalMs: minutes(5),
    warnAfterMs: minutes(15),
    criticalAfterMs: minutes(30),
  },
  {
    key: "bridge_volume_stats",
    label: "Bridge volume rollups",
    description: "Daily rollups that feed protocol and asset analytics.",
    table: "bridge_volume_stats",
    timeColumn: "stat_date",
    sourceType: "derived",
    expectedIntervalMs: hours(24),
    warnAfterMs: hours(36),
    criticalAfterMs: hours(48),
  },
  {
    key: "external_dependency_checks",
    label: "External dependency checks",
    description: "Health checks for upstream providers (RPCs, APIs).",
    table: "external_dependency_checks",
    timeColumn: "checked_at",
    sourceType: "source",
    expectedIntervalMs: minutes(2),
    warnAfterMs: minutes(5),
    criticalAfterMs: minutes(10),
  },
];
