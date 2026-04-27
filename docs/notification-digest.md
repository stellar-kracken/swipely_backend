# Notification Digest Scheduler

## Overview

The Notification Digest Scheduler provides scheduled email summaries of critical alerts, trends, and unresolved items. Users can customize digest frequency, content, and delivery preferences.

## Features

### Core Capabilities

- **Daily & Weekly Digests**: Scheduled summaries at user-preferred times
- **Per-User Preferences**: Customizable timezone, delivery time, and content filters
- **Quiet Hours**: Respect user-defined quiet hours (e.g., 10 PM - 7 AM)
- **Content Filtering**: Include/exclude specific alert types and severities
- **Trend Analysis**: Optional inclusion of metric trends
- **Unresolved Alerts**: Track alerts that remain active
- **Delivery Tracking**: Monitor sent, failed, and pending digests
- **Retry Support**: Automatic retry with exponential backoff
- **Unread Counts**: Track unread digest summaries

### Digest Content

Each digest includes:
- **Alert Summary**: Critical and high-priority alerts from the period
- **Unresolved Items**: Alerts that remain active
- **Trends**: Metric changes (e.g., TVL, health scores)
- **Top Assets**: Assets with most alerts
- **Summary Statistics**: Total alerts, critical count, etc.

## API Endpoints

### Subscription Management

#### Get User Subscription
```http
GET /api/v1/digest/subscriptions/:userAddress
Authorization: x-api-key: <user-key>
```

#### Create Subscription
```http
POST /api/v1/digest/subscriptions
Authorization: x-api-key: <user-key>
Content-Type: application/json

{
  "userAddress": "GUSER123...",
  "email": "user@example.com",
  "dailyEnabled": true,
  "weeklyEnabled": true,
  "timezone": "America/New_York",
  "preferredHour": 9,
  "preferredDayOfWeek": 1,
  "quietHours": {
    "start": 22,
    "end": 7
  },
  "includedAlertTypes": ["supply_mismatch", "bridge_downtime"],
  "includedSeverities": ["high", "critical"],
  "includeTrends": true,
  "includeUnresolved": true
}
```

**Parameters**:
- `userAddress` (required): User's Stellar address
- `email` (required): Email address for digest delivery
- `dailyEnabled` (optional, default: true): Enable daily digests
- `weeklyEnabled` (optional, default: true): Enable weekly digests
- `timezone` (optional, default: "UTC"): User's timezone (IANA format)
- `preferredHour` (optional, default: 9): Hour to send digest (0-23)
- `preferredDayOfWeek` (optional, default: 1): Day for weekly digest (0=Sunday, 6=Saturday)
- `quietHours` (optional): Hours to skip delivery
- `includedAlertTypes` (optional): Filter specific alert types (empty = all)
- `includedSeverities` (optional, default: ["high", "critical"]): Filter by severity
- `includeTrends` (optional, default: true): Include trend analysis
- `includeUnresolved` (optional, default: true): Include unresolved alerts

#### Update Subscription
```http
PATCH /api/v1/digest/subscriptions/:userAddress
Authorization: x-api-key: <user-key>
Content-Type: application/json

{
  "dailyEnabled": false,
  "preferredHour": 10,
  "includedSeverities": ["critical"]
}
```

#### Delete Subscription
```http
DELETE /api/v1/digest/subscriptions/:userAddress
Authorization: x-api-key: <user-key>
```

### Delivery History

#### Get Delivery History
```http
GET /api/v1/digest/subscriptions/:userAddress/history?limit=30
Authorization: x-api-key: <user-key>
```

#### Get Unread Count
```http
GET /api/v1/digest/subscriptions/:userAddress/unread
Authorization: x-api-key: <user-key>
```

### Admin Operations

#### List All Subscriptions
```http
GET /api/v1/digest/subscriptions?digestType=daily
Authorization: x-api-key: <admin-key>
```

#### Manually Trigger Digest Generation
```http
POST /api/v1/digest/generate
Authorization: x-api-key: <admin-key>
Content-Type: application/json

{
  "digestType": "daily"
}
```

#### Process Pending Deliveries
```http
POST /api/v1/digest/process
Authorization: x-api-key: <admin-key>
```

## Scheduling

### Automated Jobs

The system runs two scheduled jobs:

1. **Daily Digest Job**: Runs every hour
   - Checks user preferences and timezones
   - Generates digests for eligible users
   - Respects quiet hours

2. **Weekly Digest Job**: Runs every hour on Mondays
   - Checks user preferences and timezones
   - Generates weekly summaries
   - Respects quiet hours

### Delivery Processing

- **Retry Logic**: Failed deliveries retry up to 3 times
- **Retry Delay**: 30 minutes between attempts
- **Status Tracking**: pending → sent | failed | skipped

## Database Schema

### digest_subscriptions
User digest preferences.

```sql
CREATE TABLE digest_subscriptions (
  id UUID PRIMARY KEY,
  user_address TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  daily_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  preferred_hour INTEGER NOT NULL DEFAULT 9,
  preferred_day_of_week INTEGER NOT NULL DEFAULT 1,
  quiet_hours JSONB NOT NULL DEFAULT '{}',
  included_alert_types JSONB NOT NULL DEFAULT '[]',
  included_severities JSONB NOT NULL DEFAULT '["high", "critical"]',
  include_trends BOOLEAN NOT NULL DEFAULT TRUE,
  include_unresolved BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

### digest_deliveries
Delivery tracking and status.

```sql
CREATE TABLE digest_deliveries (
  id UUID PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES digest_subscriptions(id),
  digest_type TEXT NOT NULL,
  user_address TEXT NOT NULL,
  email TEXT NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  alert_count INTEGER NOT NULL DEFAULT 0,
  unresolved_count INTEGER NOT NULL DEFAULT 0,
  summary_data JSONB NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMP,
  next_retry_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

### digest_items
Individual items in a digest.

```sql
CREATE TABLE digest_items (
  id UUID PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES digest_deliveries(id),
  item_type TEXT NOT NULL,
  alert_type TEXT,
  severity TEXT,
  asset_code TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL
);
```

## Usage Examples

### Example 1: Create Subscription
```typescript
import { DigestSchedulerService } from './services/digestScheduler.service';

const service = DigestSchedulerService.getInstance();

const subscription = await service.createSubscription({
  userAddress: 'GUSER123...',
  email: 'user@example.com',
  dailyEnabled: true,
  weeklyEnabled: false,
  timezone: 'America/Los_Angeles',
  preferredHour: 8,
  quietHours: { start: 22, end: 7 },
  includedSeverities: ['critical'],
  includeTrends: true
});
```

### Example 2: Update Preferences
```typescript
const updated = await service.updateSubscription('GUSER123...', {
  preferredHour: 10,
  includedAlertTypes: ['bridge_downtime', 'supply_mismatch'],
  includeTrends: false
});
```

### Example 3: Manual Digest Generation (Admin)
```typescript
// Generate daily digests for all eligible users
const count = await service.generateDigests('daily');
console.log(`Generated ${count} digests`);

// Process pending deliveries
const delivered = await service.processPendingDeliveries();
console.log(`Delivered ${delivered} digests`);
```

### Example 4: Check Delivery History
```typescript
const history = await service.getDeliveryHistory('GUSER123...', 10);
const unreadCount = await service.getUnreadCount('GUSER123...');

console.log(`Last 10 deliveries:`, history);
console.log(`Unread digests: ${unreadCount}`);
```

## Digest Email Template

### Daily Digest Example
```
Subject: Daily Digest - December 15, 2024

Bridge Watch Daily Summary
Generated at: 2024-12-15 09:00:00 UTC

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 SUMMARY
• Total Alerts: 12
• Critical: 3
• High Priority: 5
• Unresolved: 4

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 CRITICAL ALERTS

SUPPLY MISMATCH Alert
USDC: supply_mismatch 1050000 (threshold: 1000000)
Occurred: 2024-12-15 08:45:00 UTC

BRIDGE DOWNTIME Alert
Circle Bridge: bridge_downtime detected
Occurred: 2024-12-15 07:30:00 UTC

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 TRENDS

Bridge Health Score: decreased by 5.2%
Total Value Locked: increased by 12.8%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ UNRESOLVED ALERTS

Unresolved: High TVL Alert
Alert rule "High TVL Alert" for USDC remains active

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔝 TOP ASSETS BY ALERTS

1. USDC: 5 alerts
2. EURC: 3 alerts
3. XLM: 2 alerts

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Manage your digest preferences:
https://bridge-watch.example.com/settings/digest

Unsubscribe: https://bridge-watch.example.com/unsubscribe
```

## Timezone Handling

The system uses IANA timezone identifiers (e.g., "America/New_York", "Europe/London", "Asia/Tokyo").

### Timezone Conversion
```typescript
// User in New York wants digest at 9 AM local time
// System checks current time in user's timezone
// Generates digest when local time matches preferredHour

const userHour = getUserHour(new Date(), "America/New_York");
if (userHour === subscription.preferredHour) {
  // Generate digest
}
```

### Quiet Hours
Quiet hours are also timezone-aware:
```typescript
// User sets quiet hours: 10 PM - 7 AM
// System checks current hour in user's timezone
// Skips delivery if in quiet hours

const quietHours = { start: 22, end: 7 };
const currentHour = getUserHour(new Date(), subscription.timezone);

if (isInQuietHours(currentHour, quietHours)) {
  // Skip delivery
}
```

## Retry Strategy

Failed deliveries follow this retry pattern:

1. **Attempt 1**: Immediate (when job runs)
2. **Attempt 2**: 30 minutes after first failure
3. **Attempt 3**: 30 minutes after second failure
4. **Final Status**: Marked as "failed" after 3 attempts

## Best Practices

1. **Set Realistic Quiet Hours**: Ensure delivery window is wide enough
2. **Filter Appropriately**: Too many filters may result in empty digests
3. **Monitor Delivery Status**: Check for failed deliveries regularly
4. **Use Appropriate Timezone**: Set correct timezone for accurate delivery
5. **Test with Daily First**: Start with daily digests before enabling weekly
6. **Review Unread Count**: Indicates engagement with digest content
7. **Admin Monitoring**: Regularly check pending/failed deliveries

## Integration with Email Service

The digest scheduler integrates with the existing `EmailNotificationService`:

```typescript
// Digest service uses email service for delivery
await this.emailService.sendDigestEmail(recipient, payload);
```

Email service handles:
- SMTP configuration
- Rate limiting
- Bounce tracking
- Unsubscribe management

## Monitoring

### Key Metrics to Monitor

- **Generation Rate**: Digests generated per hour
- **Delivery Success Rate**: Percentage of successful deliveries
- **Retry Rate**: Percentage requiring retries
- **Empty Digest Rate**: Digests with no content (skipped)
- **Average Items per Digest**: Content volume
- **Delivery Latency**: Time from generation to delivery

### Health Checks

```typescript
// Check pending deliveries
const pending = await db('digest_deliveries')
  .where({ status: 'pending' })
  .count();

// Check failed deliveries
const failed = await db('digest_deliveries')
  .where({ status: 'failed' })
  .where('created_at', '>', db.raw("NOW() - INTERVAL '24 hours'"))
  .count();
```

## Troubleshooting

### Digest Not Received

1. Check subscription is active: `is_active = true`
2. Verify email address is correct
3. Check quiet hours aren't blocking delivery
4. Verify timezone is set correctly
5. Check delivery history for errors
6. Ensure digest type is enabled (daily/weekly)

### Empty Digests

1. Check filter settings (alert types, severities)
2. Verify alerts exist in the period
3. Review `includeTrends` and `includeUnresolved` settings
4. Check if period has any matching data

### Failed Deliveries

1. Check email service configuration (SMTP)
2. Verify email address is valid
3. Check rate limits
4. Review error messages in `digest_deliveries.error_message`
5. Check email service logs

## Security Considerations

- Email addresses are stored securely
- Unsubscribe links should be implemented
- Digest content respects user's alert rule permissions
- API endpoints require authentication
- Admin operations require admin scope
- Sensitive data in digests should be sanitized
