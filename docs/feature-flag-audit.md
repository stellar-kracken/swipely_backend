# Feature Flag Audit Service

Tracks every feature flag change for operational review.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/config/features/audit` | Search audit history |
| `GET` | `/api/v1/config/features/audit/export` | Export audit entries (max 500) |
| `POST` | `/api/v1/config/features` | Set flag (records audit when `changedBy` provided) |

## Audit entry semantics

| Field | Meaning |
|-------|---------|
| `flagName` | Feature flag identifier |
| `environment` | Target environment (`development`, `production`, etc.) |
| `action` | `create`, `update`, or `delete` |
| `oldValue` / `newValue` | Snapshot: `{ enabled, rolloutPercentage, conditions }` |
| `changedBy` | Actor identifier (user ID, service account) |
| `changeReason` | Optional justification |
| `timestamp` | ISO-8601 change time |

## Search parameters

- `flagName`, `environment`, `changedBy`, `action` — exact filters
- `search` — partial match on flag name, actor, or reason
- `limit` (default 100, max 500), `offset` — pagination

## Storage

Table: `feature_flag_audit_logs` (migration `024_feature_flag_audit`).
