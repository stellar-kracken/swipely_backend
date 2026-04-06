# WebSocket Protocol

This service exposes a WebSocket endpoint at `/api/v1/ws` for real-time updates.

## Connection

Client connects to:

- `ws://<host>/api/v1/ws`

Once connected, the server returns a system welcome message:

```json
{
  "type": "system",
  "message": "connected",
  "clientId": "<uuid>",
  "timestamp": "2026-..."
}
```

## Supported client messages

### Subscribe to a topic

```json
{
  "type": "subscribe",
  "topic": "prices",
  "filter": {
    "symbol": "USDC"
  }
}
```

### Unsubscribe from a topic

```json
{
  "type": "unsubscribe",
  "topic": "health:USDC"
}
```

### Resume a session

```json
{
  "type": "resume",
  "clientId": "<uuid>"
}
```

### Acknowledge a message

```json
{
  "type": "ack",
  "messageId": "<message-id>"
}
```

## Server message types

### System

Used for handshake, subscription confirmation, and control events.

```json
{
  "type": "system",
  "message": "subscribed",
  "topic": "prices"
}
```

### Batch

Messages are delivered in batches for efficiency.

```json
{
  "type": "batch",
  "messages": [
    {
      "id": "<uuid>",
      "type": "price_update",
      "topic": "prices:USDC",
      "priority": "high",
      "payload": { ... },
      "timestamp": "...",
      "ackRequired": false
    }
  ]
}
```

### Replay

When a client subscribes or resumes a session, cached history is replayed.

```json
{
  "type": "replay",
  "messages": [ ... ]
}
```

## Topics

- `prices` / `prices:<symbol>`
- `health_score` / `health_score:<symbol>`
- `alert_notification`

Subscriptions support prefix matching:
- `prices` matches `prices:USDC`, `prices:PYUSD`
- `health_score` matches `health_score:USDC`

## Delivery guarantees

- High-priority messages are flushed immediately.
- Messages can require acknowledgement with `ackRequired: true`.
- Reconnection is supported via `resume`.
- Recent history is replayed after subscription or resume.

## Rate limiting

Per-client broadcast rate limiting is enforced to protect the service and keep delivery stable.
