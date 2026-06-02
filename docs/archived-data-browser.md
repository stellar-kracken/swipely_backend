# Archived Data Browser API

Read-only endpoints for inspecting historical snapshots stored in archive tables (`*_archive`) without restoring them to live tables.

## Authentication

All archive browser routes require an API key with the `archive:read` scope:

```http
GET /api/v1/archive?entityType=prices&asset=USDC
x-api-key: <your-key>
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/archive/entities` | List browsable archive entity types |
| `GET` | `/api/v1/archive` | Search archived snapshots (paginated) |
| `GET` | `/api/v1/archive/:entityType/:id` | Fetch one archived row by archive table `id` |

## Query parameters (`GET /api/v1/archive`)

| Parameter | Required | Description |
|-----------|----------|-------------|
| `entityType` | yes | One of `prices`, `health_scores`, `pool_events`, `pool_metrics` |
| `asset` | no | Asset symbol (`prices`, `health_scores`) or pool id (`pool_*`) |
| `from` | no | ISO 8601 start time (inclusive) |
| `to` | no | ISO 8601 end time (inclusive) |
| `q` | no | Case-insensitive match against the entity asset column |
| `page` | no | Page number (default `1`) |
| `pageSize` | no | Page size (default `50`, max `500`) |

## Response shape

```json
{
  "success": true,
  "data": {
    "entityType": "prices",
    "tableName": "prices_archive",
    "results": [],
    "total": 0,
    "page": 1,
    "pageSize": 50,
    "totalPages": 0
  }
}
```

## Notes

- Archive tables are populated by the data cleanup job when `archive_before_delete` is enabled on a retention policy.
- If an archive table does not exist yet, search returns an empty page instead of an error.
- These endpoints are read-only; they never mutate live or archived data.
