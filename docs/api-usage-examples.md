# API Usage Examples

These examples complement the Swagger UI at `/docs` and focus on the common request patterns used by Bridge Watch integrations.

## Authentication

Protected routes require the `x-api-key` header.

```bash
curl -H "x-api-key: $BRIDGE_WATCH_API_KEY" \
  http://localhost:3000/api/v1/alerts/history?limit=25
```

```ts
const response = await fetch("http://localhost:3000/api/v1/alerts/history?limit=25", {
  headers: {
    "x-api-key": process.env.BRIDGE_WATCH_API_KEY ?? "",
  },
});
```

## Query and Filter Examples

List alerts for a specific owner:

```bash
curl -H "x-api-key: $BRIDGE_WATCH_API_KEY" \
  "http://localhost:3000/api/v1/alerts/rules?owner=GBQ7..."
```

Search metadata and cap the returned rows:

```bash
curl "http://localhost:3000/api/v1/metadata/search?q=stable"
curl "http://localhost:3000/api/v1/metadata/symbol/USDC/sync-history?limit=10"
```

Request a paginated alert feed:

```bash
curl -H "x-api-key: $BRIDGE_WATCH_API_KEY" \
  "http://localhost:3000/api/v1/alerts/history?page=2&limit=20"
```

## Error Handling

Bridge Watch returns a compact JSON error envelope:

```json
{
  "error": "Not Found",
  "message": "The requested resource was not found"
}
```

Typical client handling:

```ts
if (!response.ok) {
  const error = await response.json();
  throw new Error(error.message ?? "Request failed");
}
```

## Pagination

Endpoints that return list data usually accept `page` and `limit` or a `limit` cap. Keep the page size small on dashboards and increase it for exports.

```bash
curl "http://localhost:3000/api/v1/exports?userId=demo&page=1&limit=20"
```

## Rate Limits

All routes are rate-limited. When a limit is exceeded, the API responds with `429 Too Many Requests` and a `Retry-After` header.

```ts
if (response.status === 429) {
  const retryAfter = response.headers.get("Retry-After");
  console.warn(`Rate limited. Retry after ${retryAfter ?? "a few"} seconds.`);
}
```

## Version Notes

All REST routes are versioned under `/api/v1/`. Keep examples pinned to the versioned path so they stay valid when new versions are introduced.

## Response Shapes

Most list endpoints follow the same pattern:

```json
{
  "items": [],
  "total": 0
}
```

For example, `/api/v1/metadata` returns `{ metadata, total }`, while `/api/v1/alerts/history` returns a paginated alert payload.

