# Configuration Service

Production-grade environment configuration service with full audit trail, hierarchical resolution, and zero-downtime deployments.

**Issue:** #377

## Features

- ✅ **Hierarchical Resolution** — Environment-specific → Global → Safe defaults
- ✅ **Full Audit Trail** — Track every change (who/when/why)
- ✅ **Type Safety** — Zod validation for all 35 configuration keys
- ✅ **Encryption at Rest** — Sensitive values encrypted in database
- ✅ **Redis Caching** — Sub-millisecond cache hits (5min TTL)
- ✅ **Cluster Coherence** — Pub/sub invalidation across instances
- ✅ **Zero-Downtime** — Safe deployments with cache TTL
- ✅ **Bulk Operations** — Atomic import/export

## Quick Start

### 1. Run Migration

```bash
npm run migrate:up
```

This creates:
- `configs` table — Core configuration storage
- `config_audits` table — Immutable audit log

### 2. Use ConfigService

```typescript
import { getDatabase } from "./database/connection.js";
import { createRedisClient } from "./config/redis.js";
import { ConfigService } from "./services/config-service/ConfigService.js";

const db = getDatabase();
const redis = createRedisClient();
const configService = new ConfigService(db, redis);

// Get configuration (hierarchical resolution)
const maxRetries = await configService.get("MAX_RETRIES", "prod-us-east");
// Returns: 5 (from prod-us-east) OR 3 (from global) OR 3 (safe default)

// Set configuration (with audit trail)
await configService.set("MAX_RETRIES", 5, {
  environment: "prod-us-east",
  changedBy: "admin@example.com",
  changeReason: "Increase for peak load",
});

// Get audit trail
const audits = await configService.getAuditTrail("MAX_RETRIES", "prod-us-east");
```

### 3. Use Admin API

```bash
# Get all configs for environment
curl http://localhost:3001/api/v1/admin/configs/prod-us-east

# Get specific config
curl http://localhost:3001/api/v1/admin/configs/prod-us-east?key=MAX_RETRIES

# Set config
curl -X POST http://localhost:3001/api/v1/admin/configs \
  -H "Content-Type: application/json" \
  -d '{
    "environment": "prod-us-east",
    "key": "MAX_RETRIES",
    "value": 5,
    "changedBy": "admin@example.com",
    "changeReason": "Increase for peak load"
  }'

# Get audit trail
curl http://localhost:3001/api/v1/admin/configs/prod-us-east/audit?key=MAX_RETRIES

# Export configs
curl -X POST http://localhost:3001/api/v1/admin/configs/export/prod-us-east

# Import configs
curl -X POST http://localhost:3001/api/v1/admin/configs/import/prod-us-east \
  -H "Content-Type: application/json" \
  -d '{
    "configs": {
      "MAX_RETRIES": 5,
      "LOG_LEVEL": "info"
    },
    "importedBy": "admin@example.com",
    "importReason": "Initial prod import"
  }'
```

### 4. Bulk Import Script

```bash
# Create config file
cat > config-prod.json << EOF
{
  "MAX_RETRIES": 5,
  "LOG_LEVEL": "info",
  "RATE_LIMIT_MAX": 200,
  "PRICE_DEVIATION_THRESHOLD": 0.02
}
EOF

# Import
tsx scripts/import-configs.ts prod-us-east ./config-prod.json admin@example.com "Initial prod import"
```

## Architecture

### Hierarchical Resolution

```
1. Environment-specific config
   ↓ (if not found)
2. Global config (fallback)
   ↓ (if not found)
3. Safe default (embedded)
   ↓ (if not found)
4. Error (required config missing)
```

**Example:**

```typescript
// Request: MAX_RETRIES in prod-us-east
await configService.get("MAX_RETRIES", "prod-us-east");

// Resolution:
// 1. Check: configs WHERE environment='prod-us-east' AND key='MAX_RETRIES'
//    → Found: 5 ✓ Return 5
//
// 2. If not found, check: configs WHERE environment='global' AND key='MAX_RETRIES'
//    → Found: 3 ✓ Return 3
//
// 3. If not found, check: SAFE_DEFAULTS['MAX_RETRIES']
//    → Found: 3 ✓ Return 3
//
// 4. If not found: throw Error
```

### Cache Strategy

- **TTL:** 5 minutes (300 seconds)
- **Prefix:** `config:environment:key`
- **Invalidation:** Redis pub/sub on every change
- **Cluster:** All instances subscribe to `config:changed` channel

**Cache Flow:**

```
1. Request config
   ↓
2. Check Redis cache
   ├─ HIT (99% path) → Return cached value (sub-ms)
   └─ MISS → Continue
   ↓
3. Query database
   ↓
4. Validate with Zod
   ↓
5. Cache for 5 minutes
   ↓
6. Return value
```

**Invalidation Flow:**

```
1. Config updated via API
   ↓
2. Delete Redis key: config:prod-us-east:MAX_RETRIES
   ↓
3. Publish event: config:changed { environment, key, timestamp }
   ↓
4. All instances receive event
   ├─ Instance A: Invalidate local cache
   ├─ Instance B: Invalidate local cache
   └─ Instance C: Invalidate local cache
   ↓
5. Next request → Cache miss → Fresh DB read
```

### Audit Trail

Every configuration change records:

```typescript
{
  config_id: 1,              // Which config changed
  old_value: 3,              // Previous value (JSONB)
  new_value: 5,              // New value (JSONB)
  changed_by: "admin@...",   // Who changed it
  change_reason: "...",      // Why it changed
  changed_at: "2026-04-28T..." // When it changed
}
```

### Encryption

Sensitive configuration keys are automatically encrypted at rest:

- `JWT_SECRET`
- `CONFIG_ENCRYPTION_KEY`
- `WS_AUTH_SECRET`
- `CIRCLE_API_KEY`
- `COINBASE_API_KEY`
- `COINBASE_API_SECRET`
- `COINMARKETCAP_API_KEY`
- `COINGECKO_API_KEY`
- `ONEINCH_API_KEY`
- `DISCORD_BOT_TOKEN`
- `SMTP_PASSWORD`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `API_KEY_BOOTSTRAP_TOKEN`

**Encryption Flow:**

```
1. Set JWT_SECRET = "my-secret"
   ↓
2. Detect sensitive key
   ↓
3. Encrypt with AES-256-GCM
   ↓
4. Store: "iv:authTag:encrypted"
   ↓
5. Get JWT_SECRET
   ↓
6. Detect encrypted flag
   ↓
7. Decrypt with AES-256-GCM
   ↓
8. Return: "my-secret"
```

## Configuration Keys

All 35 environment variables have Zod validation schemas:

### Application
- `NODE_ENV` — development | production | test | staging
- `PORT` — HTTP server port (1-65535)
- `WS_PORT` — WebSocket server port (1-65535)

### Database
- `POSTGRES_HOST` — PostgreSQL host
- `POSTGRES_PORT` — PostgreSQL port (1-65535)
- `POSTGRES_DB` — Database name
- `POSTGRES_USER` — Database user
- `POSTGRES_PASSWORD` — Database password (encrypted)

### Redis
- `REDIS_HOST` — Redis host
- `REDIS_PORT` — Redis port (1-65535)
- `REDIS_PASSWORD` — Redis password (encrypted, optional)
- `REDIS_CACHE_TTL_SEC` — Cache TTL in seconds (1-86400)
- `REDIS_CLUSTER` — Cluster mode flag (boolean)

### Stellar
- `STELLAR_NETWORK` — testnet | mainnet
- `STELLAR_HORIZON_URL` — Horizon API endpoint (URL)
- `SOROBAN_RPC_URL` — Soroban RPC endpoint (URL)
- `SOROBAN_MAINNET_RPC_URL` — Soroban mainnet RPC (URL, optional)
- `HORIZON_TIMEOUT_MS` — Horizon timeout (100-60000ms)
- `CIRCUIT_BREAKER_CONTRACT_ID` — Contract ID (optional)
- `LIQUIDITY_CONTRACT_ADDRESS` — Contract address (optional)

### EVM Chains
- `RPC_PROVIDER_TYPE` — http | ws
- `ETHEREUM_RPC_URL` — Ethereum RPC (URL, optional)
- `ETHEREUM_RPC_WS_URL` — Ethereum WebSocket (URL, optional)
- `ETHEREUM_RPC_FALLBACK_URL` — Ethereum fallback (URL, optional)
- `POLYGON_RPC_URL` — Polygon RPC (URL, optional)
- `POLYGON_RPC_FALLBACK_URL` — Polygon fallback (URL, optional)
- `BASE_RPC_URL` — Base RPC (URL, optional)
- `BASE_RPC_FALLBACK_URL` — Base fallback (URL, optional)

### Token & Bridge Addresses
- `USDC_TOKEN_ADDRESS` — USDC token address (0x..., optional)
- `USDC_BRIDGE_ADDRESS` — USDC bridge address (0x..., optional)
- `EURC_TOKEN_ADDRESS` — EURC token address (0x..., optional)
- `EURC_BRIDGE_ADDRESS` — EURC bridge address (0x..., optional)

### External APIs
- `CIRCLE_API_KEY` — Circle API key (encrypted, optional)
- `CIRCLE_API_URL` — Circle API base URL
- `CIRCLE_API_TIMEOUT_MS` — Circle timeout (1000-60000ms)
- `CIRCLE_CACHE_TTL_SEC` — Circle cache TTL (1-3600s)
- `CIRCLE_RATE_LIMIT_MAX` — Circle rate limit (1-1000)
- `CIRCLE_RATE_LIMIT_WINDOW_MS` — Circle window (1000-3600000ms)
- `COINBASE_API_KEY` — Coinbase API key (encrypted, optional)
- `COINBASE_API_SECRET` — Coinbase secret (encrypted, optional)
- `COINMARKETCAP_API_KEY` — CoinMarketCap key (encrypted, optional)
- `COINGECKO_API_KEY` — CoinGecko key (encrypted, optional)
- `ONEINCH_API_KEY` — 1inch key (encrypted, optional)

### Security
- `JWT_SECRET` — JWT signing key (encrypted, min 32 chars)
- `CONFIG_ENCRYPTION_KEY` — Config encryption key (encrypted, min 32 chars)
- `WS_AUTH_SECRET` — WebSocket auth token (encrypted, optional)
- `API_KEY_BOOTSTRAP_TOKEN` — Bootstrap token (encrypted, optional)

### Rate Limiting
- `RATE_LIMIT_MAX` — Max requests (1-10000)
- `RATE_LIMIT_WINDOW_MS` — Window duration (1000-3600000ms)
- `RATE_LIMIT_BURST_MULTIPLIER` — Burst multiplier (0-10)
- `RATE_LIMIT_WHITELIST_IPS` — Whitelisted IPs (optional)
- `RATE_LIMIT_WHITELIST_KEYS` — Whitelisted keys (optional)
- `RATE_LIMIT_ENABLE_DYNAMIC` — Dynamic rate limiting (boolean)
- `RATE_LIMIT_GLOBAL_ALERT_THRESHOLD` — Global alert threshold (0-1)
- `RATE_LIMIT_BURST_ALERT_THRESHOLD` — Burst alert threshold (0-1)
- `RATE_LIMIT_SUSTAINED_ALERT_THRESHOLD` — Sustained alert threshold (0-1)
- `RATE_LIMIT_STATS_RETENTION_HOURS` — Stats retention (1-8760 hours)
- `RATE_LIMIT_ENABLE_MONITORING` — Enable monitoring (boolean)
- `RATE_LIMIT_ADMIN_API_KEY_PREFIX` — Admin key prefix
- `RATE_LIMIT_ENDPOINT_ASSETS` — Assets endpoint limit (1-10000)
- `RATE_LIMIT_ENDPOINT_BRIDGES` — Bridges endpoint limit (1-10000)
- `RATE_LIMIT_ENDPOINT_ALERTS` — Alerts endpoint limit (1-10000)
- `RATE_LIMIT_ENDPOINT_ANALYTICS` — Analytics endpoint limit (1-10000)
- `RATE_LIMIT_ENDPOINT_CONFIG` — Config endpoint limit (1-10000)
- `RATE_LIMIT_ENDPOINT_HEALTH` — Health endpoint limit (1-10000)

### Alert Thresholds
- `PRICE_DEVIATION_THRESHOLD` — Price deviation threshold (0-1)
- `BRIDGE_SUPPLY_MISMATCH_THRESHOLD` — Supply mismatch threshold (0-1)

### Verification & Retries
- `RETRY_MAX` — Maximum retry attempts (1-10)
- `BRIDGE_VERIFICATION_INTERVAL_MS` — Verification interval (10000-3600000ms)

### Price Aggregation
- `REDIS_PRICE_CACHE_PREFIX` — Price cache prefix

### Health Score Weights
- `HEALTH_WEIGHT_LIQUIDITY` — Liquidity weight (0-1)
- `HEALTH_WEIGHT_PRICE` — Price weight (0-1)
- `HEALTH_WEIGHT_BRIDGE` — Bridge weight (0-1)
- `HEALTH_WEIGHT_RESERVES` — Reserves weight (0-1)
- `HEALTH_WEIGHT_VOLUME` — Volume weight (0-1)

### Export Service
- `EXPORT_STORAGE_PATH` — Export storage path
- `EXPORT_DOWNLOAD_URL_EXPIRY_HOURS` — Download expiry (1-168 hours)
- `EXPORT_COMPRESSION_THRESHOLD_BYTES` — Compression threshold (bytes)
- `EXPORT_STREAMING_PAGE_SIZE` — Streaming page size (10-10000)
- `EXPORT_QUEUE_CONCURRENCY` — Queue concurrency (1-10)
- `EXPORT_MAX_DATE_RANGE_DAYS` — Max date range (1-365 days)

### Logging
- `LOG_LEVEL` — fatal | error | warn | info | debug | trace
- `LOG_FILE` — Log file path (optional)
- `LOG_MAX_FILE_SIZE` — Max file size (bytes, min 1024)
- `LOG_MAX_FILES` — Max file count (1-100)
- `LOG_RETENTION_DAYS` — Retention period (1-365 days)
- `LOG_REQUEST_BODY` — Log request body (boolean)
- `LOG_RESPONSE_BODY` — Log response body (boolean)
- `LOG_SENSITIVE_DATA` — Log sensitive data (boolean)
- `REQUEST_SLOW_THRESHOLD_MS` — Slow request threshold (100-60000ms)

### Email
- `SMTP_HOST` — SMTP host (optional)
- `SMTP_PORT` — SMTP port (1-65535)
- `SMTP_SECURE` — SMTP secure (boolean)
- `SMTP_USER` — SMTP user (optional)
- `SMTP_PASSWORD` — SMTP password (encrypted, optional)
- `SMTP_FROM_ADDRESS` — From email address
- `SMTP_FROM_NAME` — From name

### Discord
- `DISCORD_BOT_TOKEN` — Discord bot token (encrypted, optional)
- `DISCORD_CLIENT_ID` — Discord client ID (optional)

### Health Check
- `HEALTH_CHECK_TIMEOUT_MS` — Health check timeout (1000-60000ms)
- `HEALTH_CHECK_INTERVAL_MS` — Health check interval (1000-3600000ms)
- `HEALTH_CHECK_MEMORY_THRESHOLD` — Memory threshold % (1-100)
- `HEALTH_CHECK_DISK_THRESHOLD` — Disk threshold % (1-100)
- `HEALTH_CHECK_EXTERNAL_APIS` — Check external APIs (boolean)

### Data Validation
- `VALIDATION_STRICT_MODE` — Strict validation mode (boolean)
- `VALIDATION_ADMIN_BYPASS` — Admin bypass (boolean)
- `VALIDATION_BATCH_SIZE` — Batch size (1-10000)
- `VALIDATION_MAX_BATCH_SIZE` — Max batch size (1-10000)
- `VALIDATION_DUPLICATE_CHECK` — Duplicate check (boolean)
- `VALIDATION_NORMALIZATION` — Normalization (boolean)
- `VALIDATION_CONSISTENCY_CHECKS` — Consistency checks (boolean)
- `VALIDATION_ERROR_THRESHOLD` — Error threshold (0-1)
- `VALIDATION_WARNING_THRESHOLD` — Warning threshold (0-1)
- `VALIDATION_DATA_QUALITY_THRESHOLD` — Quality threshold (0-100)

## Deployment Environments

- `global` — Shared across all environments
- `dev` — Development
- `staging` — Staging
- `prod-us-east` — US East production
- `prod-eu-west` — EU West production

## Testing

```bash
# Run tests
npm run test config-service

# Run with coverage
npm run test:coverage config-service
```

## Troubleshooting

### Cache not invalidating

Check Redis pub/sub:
```bash
redis-cli
> SUBSCRIBE config:changed
```

### Config not found

Check hierarchical resolution:
```bash
# 1. Check environment-specific
SELECT * FROM configs WHERE environment='prod-us-east' AND key='MAX_RETRIES';

# 2. Check global
SELECT * FROM configs WHERE environment='global' AND key='MAX_RETRIES';

# 3. Check safe defaults
# See: src/services/config-service/defaults.ts
```

### Validation errors

Check Zod schema:
```typescript
import { ConfigSchemas } from "./validators.js";

// Get schema for key
const schema = ConfigSchemas["MAX_RETRIES"];

// Validate value
const result = schema.safeParse(5);
console.log(result);
```

## License

MIT
