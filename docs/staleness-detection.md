# Staleness Detection

## Overview

The staleness detector tracks whether core data sources and derived metrics are updating
within expected windows. It compares the most recent timestamp in each table against
its freshness thresholds and reports a status of `fresh`, `warning`, `stale`, or `missing`.

## Rules

| Key | Table | Time Column | Type | Expected | Warning | Critical |
| --- | --- | --- | --- | --- | --- | --- |
| `prices` | `prices` | `time` | source | 30s | 2m | 5m |
| `liquidity_snapshots` | `liquidity_snapshots` | `time` | source | 5m | 15m | 30m |
| `health_scores` | `health_scores` | `time` | derived | 5m | 15m | 30m |
| `verification_results` | `verification_results` | `verified_at` | source | 5m | 15m | 30m |
| `bridge_volume_stats` | `bridge_volume_stats` | `stat_date` | derived | 24h | 36h | 48h |
| `external_dependency_checks` | `external_dependency_checks` | `checked_at` | source | 2m | 5m | 10m |

## Scheduled Checks

The job queue runs `staleness-detection` every 5 minutes. Any warnings or stale states
are logged, and the API exposes the same alert payload.

## API Endpoints

- `GET /api/v1/freshness`
  - Returns the current snapshot across all sources.
  - Query params: `includeHistory` (boolean), `historyLimit` (2-50).
- `GET /api/v1/freshness/:source`
  - Returns detail for a single source, including recent history.
- `GET /api/v1/freshness/:source/trend`
  - Returns trend output and recent intervals for a single source.
- `GET /api/v1/freshness/alerts`
  - Returns warning/stale/missing entries suitable for alerting.

## Updating Rules

Rules live in `backend/src/config/stalenessRules.ts`. Adjust thresholds there to match
new job schedules or ingestion intervals.
