# External Rate Limit Metrics

Measures upstream provider rate-limit usage so operations can tune consumption safely.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/metrics/external-rate-limits` | Per-provider snapshots (24h rollup) |
| `GET` | `/api/v1/metrics/external-rate-limits/:providerKey/trend` | Hourly trend buckets |
| `GET` | `/api/v1/metrics/external-rate-limits/alerts` | Active threshold violations |
| `GET` | `/api/v1/metrics/external-rate-limits/export` | Full metrics export |
| `PUT` | `/api/v1/metrics/external-rate-limits/:providerKey/thresholds` | Configure alert thresholds |
| `POST` | `/api/v1/metrics/external-rate-limits/record` | Record usage (internal) |

## Metric semantics

| Metric | Description |
|--------|-------------|
| `requestsCount` | Total requests in last 24h |
| `throttledCount` | Times provider returned throttle (429, etc.) |
| `burstCount` | Burst events detected |
| `limitRemaining` / `limitTotal` | From provider response headers when available |
| `usagePercent` | `(limitTotal - limitRemaining) / limitTotal * 100` |
| `isThrottled` | Provider currently throttling |

## Alert thresholds

Default per provider (configurable via PUT):

- **usage warning**: 70%
- **usage critical**: 90%
- **burst warning**: 5 events / 24h

Alert types: `usage`, `burst`, `throttle`.

## Recording usage

Integrate from provider clients:

```json
POST /api/v1/metrics/external-rate-limits/record
{
  "providerKey": "coingecko",
  "limitRemaining": 450,
  "limitTotal": 500,
  "throttled": false,
  "burst": false
}
```

## Storage

- `external_rate_limit_metrics` — time-series samples
- `external_rate_limit_alert_thresholds` — per-provider alert config
