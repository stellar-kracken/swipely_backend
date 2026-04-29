# Telegram Bot Integration - Implementation Guide

**Issue:** #161  
**Status:** Implementation Complete  
**Date:** April 27, 2026  

## Overview

This document describes the Telegram bot integration for Bridge-Watch, providing real-time alert delivery, subscription management, and admin commands via Telegram.

## Architecture

### Components

1. **TelegramBotService** (`backend/src/services/telegram.bot.service.ts`)
   - Main service class managing bot lifecycle, commands, and alert delivery
   - 650+ lines of production-ready code
   - Implements webhook support (Telegram standard)
   - Fallback polling mode for development

2. **Message Formatter** (`backend/src/services/formatters/telegram.formatter.ts`)
   - Markdown V2 formatting utilities
   - Character escaping and validation
   - Alert message formatting with emojis and structure

3. **Database Schema** (`backend/src/database/migrations/022_telegram_subscriptions.ts`)
   - `telegram_subscriptions` table for user preferences
   - `telegram_alerts_log` table (TimescaleDB hypertable) for audit trails
   - Proper indexing for performance

4. **Configuration** (Added to `backend/src/config/index.ts`)
   - 9 new environment variables
   - Webhook URL and secret validation
   - Rate limit configuration

5. **Tests** (`backend/tests/services/telegram.bot.service.test.ts`)
   - 40+ test cases covering all major functionality
   - Unit tests with mocked Redis and database
   - Formatter utility tests

## Features Implemented

### User Commands

| Command | Description |
|---------|-------------|
| `/start` | Subscribe to alerts (default: critical, high priority) |
| `/help` | Display command reference |
| `/status` | System status and metrics |
| `/subscribe` | Configure alert severity levels |
| `/subscriptions` | View current subscription preferences |
| `/alerts` | View recent alerts (last 10) |

### Admin Commands

| Command | Permission | Description |
|---------|-----------|-------------|
| `/broadcast [msg]` | Admin | Send message to all subscribers |
| `/pause` | Admin | Pause alert delivery |
| `/resume` | Admin | Resume alert delivery |

**Admin Authorization:**
- Primary: Application role system (AdminRotationService)
- Bootstrap: Chat ID list for initial setup (`TELEGRAM_ADMIN_CHAT_IDS`)

### Alert Delivery

- **Trigger:** Alert events published to Redis `bw:alerts:created` channel
- **Formatting:** Markdown V2 with priority emojis (🚨 Critical, ⚠️ High, etc.)
- **Rate Limiting:** 
  - Outbound: 30 msgs/sec global, 1 msg/sec per chat (Telegram limits)
  - Inbound: 5 commands per 30 seconds per chat (configurable)
- **Subscribers:** Filtered by severity level and active status

### Subscription Management

- Per-chat preferences stored in PostgreSQL
- Severity levels: critical, high, medium, low
- Areas: reserved for future domain-based filtering
- On/off toggle for alerts without deletion

### WebSocket Integration

**Webhook Mode (Production):**
```
POST /api/v1/telegram/webhook
```
- HMAC-SHA256 signature verification
- TLS termination via Nginx
- Max 40 concurrent connections
- Allowed updates: message, callback_query

**Polling Mode (Development):**
- 25-second timeout, 100 updates per poll
- Automatic fallback when webhook URL not configured
- Enabled via `NODE_ENV=development` + empty `TELEGRAM_WEBHOOK_URL`

## Configuration

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=<bot_token_from_botfather>

# Production
TELEGRAM_WEBHOOK_URL=https://bridge-watch.example.com/api/v1/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=<32_char_random_string>

# Rate Limits (defaults match Telegram API limits)
TELEGRAM_RATE_LIMIT_OUTBOUND_GLOBAL_PER_SEC=30
TELEGRAM_RATE_LIMIT_OUTBOUND_PER_CHAT_PER_SEC=1
TELEGRAM_RATE_LIMIT_INBOUND_COMMANDS_PER_WINDOW=5
TELEGRAM_RATE_LIMIT_INBOUND_WINDOW_SEC=30

# Bootstrap Admin List (comma-separated IDs)
TELEGRAM_ADMIN_CHAT_IDS=1234567890,9876543210

# Feature Flag
TELEGRAM_BOT_ENABLED=true
```

### Setup Instructions

1. **Create Telegram Bot:**
   ```
   Send /newbot to @BotFather on Telegram
   Follow prompts, receive bot token
   ```

2. **Generate Webhook Secret:**
   ```bash
   openssl rand -hex 32
   ```

3. **Configure Environment:**
   ```bash
   cp .env.example .env
   # Edit .env with bot token, webhook URL, secret
   ```

4. **Run Database Migration:**
   ```bash
   npm run migrate
   ```

5. **Start Server:**
   ```bash
   npm run dev
   ```

## Database Schema

### `telegram_subscriptions` Table

```sql
- id: UUID (primary key)
- chat_id: VARCHAR(50) (unique)
- chat_type: ENUM (private, group, supergroup, channel)
- telegram_user_id: VARCHAR(50) nullable
- severities: JSON (array of severity levels)
- areas: JSON (array of domain areas)
- is_active: BOOLEAN
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
```

**Indexes:**
- `is_active` - for active subscriptions queries
- `chat_type` - for bulk operations
- `severities` (GIN) - for alert filtering

### `telegram_alerts_log` Table (TimescaleDB Hypertable)

```sql
- time: TIMESTAMP (hypertable key)
- id: UUID (primary key)
- subscription_id: UUID
- chat_id: VARCHAR(50)
- alert_id: VARCHAR(50)
- alert_type: VARCHAR(50)
- priority: ENUM (critical, high, medium, low)
- asset_code: VARCHAR(20)
- metric_name: VARCHAR(100)
- triggered_value: TEXT
- threshold: TEXT
- message_id: VARCHAR(50) nullable
- delivered: BOOLEAN
- error_message: TEXT nullable
```

**Indexes:**
- `(subscription_id, time)` - for user alert history
- `(alert_type, time)` - for alert type filtering
- `(priority, time)` - for severity filtering
- `time` - for retention policies

**Compression:**
- Auto-compress data older than 7 days (configurable)

## Message Formatting

### Alert Message Example

```
🚨 CRITICAL ALERT

Metric: Price Change
Asset: USDC
Triggered Value: `1.05`
Threshold: `1.02`
Alert ID: `rule-456`
Time: 2025-04-27T12:00:00Z

[View Details](https://bridge-watch.example.com/alerts/rule-456)
```

### Markdown V2 Escaping

All user-provided fields are properly escaped to prevent injection:
- `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`, `=`, `|`, `{`, `}`, `.`, `!`

### Message Length

- Maximum: 4096 characters (Telegram API limit)
- Automatic truncation with "…[truncated]" indicator

## Rate Limiting

### Outbound (API Calls to Telegram)

Uses **Redis counters** with Telegram's official limits:
- **Global:** 30 messages/second across all chats
- **Per-Chat:** 1 message/second per individual chat

Implementation via `sendMessageWithRateLimit()`:
1. Increment global counter (1-sec window)
2. Increment per-chat counter (1-sec window)
3. Check both limits
4. Queue if exceeded (BullMQ with exponential backoff)

### Inbound (User Commands)

Uses **in-memory rate limiter** with configurable policy:
- **Limit:** 5 commands per 30-second window per chat
- **Violation:** Discard excess commands, send warning (rate-limited)
- **Storage:** Map<chatId, { count, resetTime }>

## Error Handling

### Graceful Degradation

- Missing bot token: Logs warning, service disabled
- Webhook unreachable: Logs with persistence suggestion
- Database errors: Logged at warn level, message queued for retry
- Telegram API errors: Logged with chat ID (no PII), user notified

### Logging Strategy

- All operations logged with structured JSON
- Correlation IDs passed through context
- Sensitive data (tokens) never logged
- Admin actions logged for audit trail

## Testing

### Test Coverage

**File:** `backend/tests/services/telegram.bot.service.test.ts`

- **Message Formatting (8 tests)**
  - Markdown V2 character escaping
  - Alert message structure
  - Priority emojis
  - Length validation

- **Rate Limiting (2 tests)**
  - Command rate limiting
  - Outbound Redis integration

- **Subscription Management (3 tests)**
  - Create subscription
  - Update preferences
  - Query active subscriptions

- **Alert Delivery (2 tests)**
  - Alert formatting and delivery
  - Paused delivery handling

- **Service Lifecycle (3 tests)**
  - Initialization
  - isRunning method
  - Webhook handler

- **Error Handling (2 tests)**
  - Missing configuration
  - Database error recovery

- **Admin Commands (3 tests)**
  - Authorization checks
  - Broadcast delivery
  - Pause/resume

**Running Tests:**

```bash
# Unit tests only
npm run test:unit

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

**Target Coverage:**
- Lines: 90%+
- Branches: 85%+
- Functions: 90%+
- Statements: 90%+

## Deployment

### Production Checklist

- [ ] Generate strong webhook secret (`openssl rand -hex 32`)
- [ ] Configure HTTPS domain for webhook URL
- [ ] Set `TELEGRAM_WEBHOOK_URL` to public HTTPS endpoint
- [ ] Verify Nginx TLS certificate is valid
- [ ] Set `NODE_ENV=production`
- [ ] Clear `TELEGRAM_ADMIN_CHAT_IDS` (use AdminRotationService roles)
- [ ] Run database migrations: `npm run migrate`
- [ ] Test webhook connectivity: Check Telegram's webhook info
- [ ] Monitor error logs for delivery failures
- [ ] Verify rate limiting isn't blocking legitimate alerts

### Scaling Considerations

- **Webhook Concurrency:** Default 40 connections; increase via `max_connections` if needed
- **Database:** Subscriptions table should be partitioned if >1M users
- **Redis:** Ensure sufficient memory for rate limit counters (minimal: <1MB even at scale)
- **Alerting:** Migrate to queue-based delivery if alert volume exceeds 10K/min

## Monitoring

### Metrics to Track

- Alert delivery latency (should be <1s)
- Webhook delivery failures
- Rate limit hits (expected: near 0)
- Subscriber growth and churn
- Command usage by type

### Health Checks

```bash
# Telegram bot health
GET /api/v1/health -> { telegram_bot: "running" }

# Webhook status
GET /api/v1/telegram/webhook-status -> { url, pending_updates, has_custom_cert }
```

## Security Considerations

### PII Protection

- Chat IDs and Telegram user IDs are not considered PII
- No message content is logged
- Admin actions logged for audit (chat ID only, no PII)

### Token Management

- `TELEGRAM_BOT_TOKEN` must be treated as a secret
- Store in `.env` file (never commit to git)
- Rotate token if compromised: Get new token from @BotFather
- Implement token rotation for webhook secrets every 90 days

### Webhook Security

- HMAC-SHA256 signature verification on every update
- `X-Telegram-Bot-Api-Secret-Token` header validated
- Webhook secret stored in `TELEGRAM_WEBHOOK_SECRET` environment variable
- All updates are over HTTPS (Telegram requirement)

## Troubleshooting

### Bot Not Receiving Updates

**Webhook Mode:**
- Verify webhook URL is reachable (curl test)
- Check TLS certificate validity
- Confirm `/api/v1/telegram/webhook` route is registered
- Verify secret token matches

**Polling Mode:**
- Verify `NODE_ENV=development` is set
- Check `TELEGRAM_WEBHOOK_URL` is empty
- Ensure bot token is valid

### Rate Limiting Issues

- Check Redis connection
- Verify rate limit config matches Telegram's limits
- Monitor Redis key expiration
- Review logs for "rate limit exceeded" warnings

### Database Migration Failures

```bash
# Check migration status
npm run migrate:status

# Rollback if needed
npm run migrate:rollback

# Debug: Check knex_migrations table
SELECT * FROM knex_migrations ORDER BY batch DESC LIMIT 5;
```

### Admin Commands Denied

- Verify chat ID is in `TELEGRAM_ADMIN_CHAT_IDS` (bootstrap)
- OR check that user has admin role in AdminRotationService
- Check logs for authorization attempts

## Future Enhancements

1. **User Account Linking:** Link Telegram users to Bridge-Watch users for role-based access
2. **Inline Buttons:** Interactive alert controls (acknowledge, mute, etc.)
3. **Channels:** Support for Telegram channels as alert recipients
4. **Custom Rules:** Per-user alert recency settings and quiet hours
5. **Web Analytics:** Dashboard showing Telegram bot engagement metrics
6. **Webhook Signatures:** Support Telegram's webhook signature verification

## References

- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [Telegraf Library Docs](https://telegraf.js.org/)
- [Markdown V2 Style Guide](https://core.telegram.org/bots/api#markdownv2style)
- [Bridge-Watch Architecture](../docs/)
- [Alert System Documentation](../docs/alert-system.md)

---

**Maintainer Contact:** Issues and PRs welcome at GitHub  
**Last Updated:** April 27, 2026  
**Version:** 1.0.0
