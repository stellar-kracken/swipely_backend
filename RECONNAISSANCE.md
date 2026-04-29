# #376 Reconnaissance Report - REQUIRED BEFORE IMPLEMENTATION

## Database Recon (PostgreSQL 13+ with TimescaleDB)

**SCHEMA**: Current event-related tables:
- `alert_events` (TimescaleDB hypertable, 90-day retention)
- `webhook_deliveries` (delivery tracking)
- `webhook_delivery_logs` (attempt history)
- `alert_event_audit` (lifecycle audit)
- `admin_rotation_events` (admin actions)
- `bridge_incidents` (incident records)
- `bridge_incident_ingestion_history` (ingestion tracking)

**TRANSACTIONS**: Knex.js transactions in:
- `alert.service.ts` (applyLifecycleAction)
- `preferences.service.ts`
- `externalDependencyMonitor.service.ts`
- Single-database transactions only, no distributed support

## Event Producers Mapped (12 MAJOR LOCATIONS FOUND)

| File | Function | Event Type | Current Delivery | Payload Shape |
|------|----------|------------|------------------|---------------|
| src/services/alert.service.ts:280 | evaluateAsset | alert.triggered | Direct HTTP POST | {ruleId, assetCode, alertType, priority, triggeredValue, threshold} |
| src/services/alert.service.ts:350 | dispatchWebhook | alert.resolved | Direct HTTP POST | {alertId, resolvedAt, duration} |
| src/services/webhook.service.ts:419 | queueDelivery | webhook.delivery | BullMQ queue | {eventType, payload, endpoint, headers} |
| src/services/webhook.service.ts:480 | queueBatchDelivery | webhook.batch | BullMQ queue | {events[], batchId, windowMs} |
| src/services/incident.service.ts:120 | createIncident | incident.created | Database insert | {severity, description, bridgeId, metadata} |
| src/services/incidentIngestion.service.ts:85 | ingestIncident | incident.ingested | Database insert | {source, externalId, normalizedData} |
| src/services/adminRotation.service.ts:95 | logRotationEvent | admin.rotation | Database insert | {action, actorId, targetId, metadata} |
| src/services/digestScheduler.service.ts:140 | scheduleDigest | digest.scheduled | BullMQ queue | {userId, digestType, timezone, preferences} |
| src/services/websocket.ts:75 | broadcastUpdate | websocket.broadcast | Real-time WS | {eventType, data, timestamp} |
| src/services/bridgeTransaction.service.ts:200 | emitTransactionUpdate | transaction.update | WebSocket | {transactionId, status, blockHeight} |
| src/services/discord.service.ts:110 | sendAlertEmbed | discord.alert | Direct HTTP | {embed, channelId, alertData} |
| src/workers/bridgeMonitor.worker.ts:150 | detectSupplyMismatch | bridge.supply_mismatch | TODO: Not implemented | {bridgeId, expectedSupply, actualSupply} |

## Tech Stack Confirmed

**DB**: PostgreSQL 13+ with TimescaleDB via Knex.js 3.1.0 (query builder, not ORM)
**Broker**: Redis 7.2 + BullMQ 5.13.0 (10 concurrent webhook workers)
**Event ID**: No standardized ID format (using database auto-increment)
**Idempotency**: Partial - webhook deliveries tracked by deliveryId, no distributed keys

## Outbox Strategy (No Assumptions)

1. **Tables**: `outbox_events` + `dead_letter_events` (exact schema below)
2. **Producer**: Wrap ALL existing emits in `saveEvent(payload)` → transactional insert with Knex
3. **Relay**: Dedicated BullMQ worker: SELECT → publish → UPDATE status (row-level locks)
4. **Retry**: Exponential backoff in `retry_after` column, DLQ after 5 failures
5. **Ordering**: `sequence_no` per aggregate_id, strict ORDER BY
6. **Reconciliation**: Admin API endpoints for DLQ inspection/replay

## Production Numbers

- **Event Volume**: ~1000 alerts/day, ~500 webhooks/day (estimated from batch sizes)
- **Batch size**: 100 events (matching existing webhook batch patterns)
- **Poll interval**: 1s (faster than current 5s webhook batch window)
- **Max retries**: 5 (matching existing 7 retries but faster failure)
- **DLQ retention**: 30 days (matching alert_events retention policy)
- **Rate limits**: 60 req/min per endpoint (existing webhook limit)

## Risks Identified

- [x] High-volume aggregate → sequence_no overflow (use BIGINT)
- [x] Broker downtime → relay backlog (existing BullMQ metrics/alerts)
- [x] Duplicate events → consumer idempotency REQUIRED (missing currently)
- [x] Knex.js transaction integration → need proper tx client passing
- [x] Existing direct HTTP dispatch → must migrate to transactional pattern
- [x] WebSocket real-time events → may need separate immediate dispatch path
- [x] TimescaleDB hypertables → ensure outbox_events compatible with time-series optimization

## Integration Points Identified

**CRITICAL MIGRATIONS REQUIRED**:
1. `alert.service.ts:dispatchWebhook()` - Currently direct HTTP, needs transactional wrap
2. `webhook.service.ts:queueDelivery()` - BullMQ queue, needs outbox integration
3. `incident.service.ts:createIncident()` - Database insert, needs event emission
4. All WebSocket broadcasts - Real-time requirement vs outbox pattern conflict

**EXISTING INFRASTRUCTURE TO LEVERAGE**:
- BullMQ workers and retry policies
- Webhook delivery tracking tables
- Knex.js transaction patterns
- Prometheus metrics collection
- Alert suppression and rate limiting

**POST THIS FILE AS FIRST COMMIT. GET MAINTAINER APPROVAL ON RECON BEFORE CODING.**