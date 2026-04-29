# Outbox Pattern Implementation - Bridge Watch

## Overview

This document describes the complete implementation of the Transactional Outbox Pattern in Bridge Watch, providing guaranteed event delivery with at-least-once semantics, ordering guarantees, retry logic, and dead-letter queue handling.

## Architecture

### Core Components

1. **OutboxProducer** - Transactional event publishing
2. **OutboxDispatcher** - Event relay with retry logic
3. **OutboxAdminApi** - Management and monitoring
4. **Outbox-integrated Services** - Alert and Webhook services

### Database Schema

```sql
-- Main outbox table
CREATE TABLE outbox_events (
  id BIGSERIAL PRIMARY KEY,
  aggregate_type VARCHAR(64) NOT NULL,    -- "Alert", "Webhook", "Bridge"
  aggregate_id UUID NOT NULL,             -- Domain entity ID
  sequence_no BIGINT NOT NULL,            -- Per-aggregate ordering
  event_type VARCHAR(64) NOT NULL,        -- "alert.triggered", "webhook.delivery"
  payload JSONB NOT NULL,                 -- Event data
  metadata JSONB DEFAULT '{}',            -- Tracing, timestamps
  status VARCHAR(20) DEFAULT 'pending',   -- pending|processing|delivered|failed
  retry_count INT DEFAULT 0,
  retry_after TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dead letter queue
CREATE TABLE dead_letter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id BIGINT REFERENCES outbox_events(id),
  event_type VARCHAR(64),
  aggregate_id UUID,
  payload JSONB,
  error_count INT DEFAULT 1,
  last_error TEXT,
  last_attempt TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sequence management
CREATE TABLE outbox_events_sequence (
  aggregate_type VARCHAR(64),
  aggregate_id UUID,
  seq BIGINT DEFAULT 0,
  PRIMARY KEY (aggregate_type, aggregate_id)
);
```

## Usage Examples

### Publishing Events Transactionally

```typescript
import { OutboxProducer } from "./outbox/eventProducer.js";
import { getDatabase } from "./database/connection.js";

const db = getDatabase();
const outboxProducer = new OutboxProducer(db);

// Within a business transaction
await db.transaction(async (tx) => {
  // Business logic
  await tx("alert_rules").insert(ruleData);
  
  // Publish event atomically
  await outboxProducer.publishTransactional(tx, {
    aggregateType: "Alert",
    aggregateId: ruleId,
    eventType: "alert.triggered",
    payload: {
      ruleId,
      assetCode: "USDC",
      alertType: "price_deviation",
      triggeredValue: 1.05,
      threshold: 1.02,
    },
    metadata: {
      traceId: "alert-123-456",
      source: "alert-service",
    },
  });
});
```

### Alert Service Integration

```typescript
import { OutboxAlertService } from "./services/alert.service.outbox.js";

const alertService = new OutboxAlertService();

// Evaluate metrics and trigger alerts with outbox guarantees
const triggeredAlerts = await alertService.evaluateAsset(metricSnapshot);
// Events are automatically published to outbox within the transaction
```

### Webhook Service Integration

```typescript
import { OutboxWebhookService } from "./services/webhook.service.outbox.js";

const webhookService = new OutboxWebhookService();

// Queue webhook delivery with transactional guarantees
const delivery = await webhookService.queueDelivery({
  webhookEndpointId: "endpoint-123",
  eventType: "alert.triggered",
  payload: alertData,
});
```

## Event Dispatcher

The dispatcher polls for pending events and processes them with retry logic:

```typescript
import { OutboxDispatcher } from "./outbox/eventDispatcher.js";

const dispatcher = new OutboxDispatcher(db, {
  batchSize: 100,
  pollIntervalMs: 1000,
  maxRetries: 5,
  concurrency: 10,
});

await dispatcher.start();
```

### Retry Strategy

- **Exponential Backoff**: 1s → 2s → 4s → 8s → 15s (capped)
- **Max Retries**: 5 attempts before moving to dead letter queue
- **Jitter**: Random variance to prevent thundering herd

## Administration API

### Health Check

```bash
GET /api/v1/health/outbox
```

Response:
```json
{
  "status": "healthy",
  "details": {
    "initialized": true,
    "dispatcherRunning": true,
    "pendingEvents": 42,
    "failedEvents": 2,
    "deadLetterEvents": 1
  },
  "timestamp": "2026-04-28T16:10:35.123Z"
}
```

### Statistics

```bash
GET /api/v1/admin/outbox/stats
Authorization: Bearer admin-token
```

Response:
```json
{
  "outbox": {
    "pending": 42,
    "processing": 5,
    "delivered": 1250,
    "failed": 3,
    "totalEvents": 1300
  },
  "deadLetter": {
    "total": 2,
    "byEventType": [
      { "eventType": "webhook.delivery", "count": 1 },
      { "eventType": "alert.triggered", "count": 1 }
    ],
    "byError": [
      { "error": "Connection timeout", "count": 1 },
      { "error": "Invalid webhook URL", "count": 1 }
    ]
  },
  "dispatcher": {
    "queueWaiting": 0,
    "queueActive": 2,
    "isRunning": true
  }
}
```

### Retry Failed Events

```bash
POST /api/v1/admin/outbox/retry/123
Authorization: Bearer admin-token
```

```bash
POST /api/v1/admin/outbox/retry-batch
Authorization: Bearer admin-token
Content-Type: application/json

{
  "eventIds": ["123", "456", "789"]
}
```

### Pending Events

```bash
GET /api/v1/admin/outbox/pending?limit=50&offset=0&eventType=alert.triggered
Authorization: Bearer admin-token
```

## Event Types

### Alert Events

- `alert.triggered` - Alert rule fired
- `alert.resolved` - Alert condition cleared
- `alert.acknowledged` - Alert acknowledged by user
- `alert.closed` - Alert manually closed

### Webhook Events

- `webhook.delivery` - Single webhook delivery
- `webhook.batch_delivery` - Batch webhook delivery
- `webhook.endpoint_created` - New webhook endpoint
- `webhook.endpoint_updated` - Webhook endpoint modified

### System Events

- `bridge.status_changed` - Bridge health status change
- `health.score_changed` - Asset health score update
- `incident.created` - New bridge incident
- `admin.rotation` - Admin role changes

## Delivery Guarantees

### At-Least-Once Delivery

- Events are persisted transactionally with business data
- Dispatcher uses row-level locks to prevent duplicate processing
- Failed events are retried with exponential backoff
- Dead letter queue captures permanently failed events

### Ordering Guarantees

- Events are ordered by `(aggregate_type, aggregate_id, sequence_no)`
- Sequence numbers are gapless per aggregate
- Dispatcher processes events in strict order within each aggregate

### Failure Modes

1. **Database Failure**: Transaction rollback prevents partial state
2. **Dispatcher Crash**: Events remain in pending state, processed on restart
3. **Message Broker Failure**: Events accumulate in outbox, processed when broker recovers
4. **Webhook Endpoint Down**: Exponential backoff with eventual dead letter queue

## Monitoring & Alerting

### Key Metrics

- `outbox_events_pending_total` - Pending events count
- `outbox_events_failed_total` - Failed events count
- `outbox_events_delivered_total` - Successfully delivered events
- `outbox_dispatcher_processing_duration` - Event processing time
- `outbox_dead_letter_events_total` - Dead letter queue size

### Alerts

- **High Pending Events**: > 1000 pending events
- **High Failure Rate**: > 10% events failing
- **Dead Letter Growth**: > 50 events in DLQ
- **Dispatcher Down**: No events processed in 5 minutes

## Performance Considerations

### Batch Processing

- Default batch size: 100 events
- Configurable poll interval: 1 second
- Concurrent workers: 10 (configurable)

### Database Optimization

- Indexes on `(status, retry_after)` for efficient polling
- Indexes on `(aggregate_type, aggregate_id, sequence_no)` for ordering
- Partitioning by created_at for large volumes (future enhancement)

### Cleanup

- Delivered events older than 30 days are purged
- Dead letter events older than 90 days are purged
- Configurable retention policies

## Migration Guide

### From Direct Webhook Dispatch

**Before:**
```typescript
// Direct HTTP call (not transactional)
await fetch(webhookUrl, {
  method: "POST",
  body: JSON.stringify(payload),
});
```

**After:**
```typescript
// Transactional outbox
await db.transaction(async (tx) => {
  await businessLogic(tx);
  await outboxProducer.publishTransactional(tx, {
    aggregateType: "Alert",
    aggregateId: alertId,
    eventType: "alert.triggered",
    payload: webhookPayload,
  });
});
```

### From BullMQ Direct Queuing

**Before:**
```typescript
// Direct queue (not transactional)
await queue.add("webhook-delivery", jobData);
```

**After:**
```typescript
// Outbox integration
await webhookService.queueDelivery({
  webhookEndpointId,
  eventType,
  payload,
});
```

## Testing

### Unit Tests

```bash
cd backend
npm test src/outbox/outbox.test.ts
```

### Integration Tests

```bash
# Start test database
docker-compose -f docker-compose.test.yml up -d

# Run integration tests
npm run test:integration

# Cleanup
docker-compose -f docker-compose.test.yml down
```

### Load Testing

```bash
# Generate test events
curl -X POST http://localhost:3001/api/v1/admin/outbox/test/generate \
  -H "Authorization: Bearer admin-token" \
  -H "Content-Type: application/json" \
  -d '{"count": 10000, "eventType": "alert.triggered"}'

# Monitor processing
watch curl -s http://localhost:3001/api/v1/health/outbox
```

## Troubleshooting

### High Pending Events

1. Check dispatcher status: `GET /api/v1/health/outbox`
2. Verify message broker connectivity
3. Check for database locks: `SELECT * FROM pg_locks WHERE relation = 'outbox_events'::regclass`
4. Scale dispatcher concurrency if needed

### Events Stuck in Processing

1. Identify stuck events: `SELECT * FROM outbox_events WHERE status = 'processing' AND created_at < NOW() - INTERVAL '5 minutes'`
2. Reset to pending: `UPDATE outbox_events SET status = 'pending' WHERE id IN (...)`
3. Investigate dispatcher logs for errors

### Dead Letter Queue Growth

1. Analyze error patterns: `GET /api/v1/admin/outbox/stats`
2. Fix underlying issues (webhook URLs, network connectivity)
3. Retry recoverable events: `POST /api/v1/admin/outbox/retry-batch`
4. Purge unrecoverable events if necessary

## Security Considerations

### Admin API Authentication

- Bearer token authentication required
- Configurable via `ADMIN_API_TOKEN` environment variable
- Consider JWT tokens for production with proper key rotation

### Event Payload Security

- Sensitive data should be encrypted before storing in payload
- Consider payload size limits to prevent DoS
- Audit logging for admin operations

### Network Security

- Admin API should be accessible only from internal networks
- Use HTTPS for all webhook deliveries
- Validate webhook signatures to prevent spoofing

## Future Enhancements

### Exactly-Once Delivery

- Add idempotency keys to event payloads
- Implement consumer-side deduplication
- Track delivery confirmations

### Event Sourcing

- Store events as immutable facts
- Add event versioning and schema evolution
- Implement event replay capabilities

### Distributed Outbox

- Support for multiple database instances
- Consistent hashing for event distribution
- Cross-region replication

### Advanced Monitoring

- Distributed tracing integration
- Custom metrics and dashboards
- Automated failure recovery