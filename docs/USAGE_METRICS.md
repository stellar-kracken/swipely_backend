# Usage Metrics API

This service provides a lightweight usage metrics store for queryable aggregates.

- Middleware: backend/src/api/middleware/usageMetrics.ts
  - Records endpoint, method, status_code, duration_ms, user_id and metadata on response (fire-and-forget).

- Table: usage_metrics (migration 024_usage_metrics.ts)
  - Fields: id, endpoint, method, status_code, duration_ms, user_id, metadata, created_at

- API: GET /api/v1/admin/usage-metrics
  - Query params:
    - start, end: ISO timestamps
    - groupBy: endpoint | user_id
    - rollup: hour | day
    - format: json | csv
  - Requires admin scope

Example: GET /api/v1/admin/usage-metrics?start=2026-06-01T00:00:00Z&end=2026-06-02T00:00:00Z&groupBy=endpoint&rollup=hour

Response: array of rows with period (timestamp), key (group value), count, avg_ms, p95_ms
