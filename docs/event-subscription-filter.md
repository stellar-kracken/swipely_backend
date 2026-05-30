# Event Subscription Filter

Subscribers filter platform events by asset, severity, source, and channel.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/event-subscriptions/:userId` | Create subscription |
| `GET` | `/api/v1/event-subscriptions/:userId` | List subscriptions |
| `PATCH` | `/api/v1/event-subscriptions/:userId/:id` | Update subscription |
| `DELETE` | `/api/v1/event-subscriptions/:userId/:id` | Delete subscription |
| `POST` | `/api/v1/event-subscriptions/:userId/preview` | Preview matching events |
| `GET` | `/api/v1/event-subscriptions/:userId/:id/audit` | Audit trail |
| `POST` | `/api/v1/event-subscriptions/dispatch` | Match event to subscriptions (internal) |

## Filter expression

All fields are optional; omitted fields match any value.

```json
{
  "assets": ["USDC", "XLM"],
  "severities": ["warning", "critical"],
  "sources": ["horizon", "circle"],
  "eventTypes": ["bridge.status_changed", "alert.triggered"],
  "channels": ["webhook", "discord"]
}
```

Matching is **AND** across specified dimensions.

## Event shape (dispatch / preview)

```json
{
  "eventType": "bridge.status_changed",
  "asset": "USDC",
  "severity": "warning",
  "source": "circle",
  "channel": "webhook",
  "payload": {}
}
```

## Audit trail

Actions logged: `created`, `updated`, `deleted`, `matched`, `preview`.

## Storage

- `event_subscriptions` — persisted rules
- `event_subscription_audit_logs` — append-only audit
