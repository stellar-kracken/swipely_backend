# Bridge Health Snapshot API

Lightweight aggregated view of current bridge health and recent trends.

## Endpoint

`GET /api/v1/bridges/snapshot`

### Query parameters

| Param | Type | Description |
|-------|------|-------------|
| `bypassCache` | boolean | Force fresh computation (default `false`) |

### Response fields

| Field | Description |
|-------|-------------|
| `timestamp` | Snapshot generation time (ISO-8601) |
| `overallStatus` | `healthy`, `degraded`, or `down` (worst bridge wins) |
| `assetCoverage` | Counts: `total`, `healthy`, `degraded`, `down` |
| `bridges` | Per-bridge: name, status, TVL, mismatch %, lastChecked |
| `trendSummary` | 24h aggregate: `direction`, `averageScore`, `windowHours` |
| `cached` | Whether response came from Redis cache |

### Caching

Responses are cached in Redis for **30 seconds** under key `bw:bridge-health-snapshot`.

## Example

```json
{
  "timestamp": "2026-05-30T12:00:00.000Z",
  "overallStatus": "healthy",
  "assetCoverage": { "total": 3, "healthy": 3, "degraded": 0, "down": 0 },
  "bridges": [{ "name": "circle", "status": "healthy", "totalValueLocked": 1000000, "mismatchPercentage": 0, "lastChecked": "..." }],
  "trendSummary": { "direction": "stable", "averageScore": 85, "windowHours": 24 },
  "cached": false
}
```
