# #377 Configuration Service Reconnaissance Report

**Date:** April 28, 2026 | **Status:** READY FOR REVIEW

## 1. Environment Variables Mapped

**TOTAL: 35 process.env references found**

### Critical Infrastructure (MUST MANAGE)
- NODE_ENV, PORT, WS_PORT
- POSTGRES_HOST/PORT/DB/USER/PASSWORD
- REDIS_HOST/PORT/PASSWORD, REDIS_CLUSTER
- STELLAR_NETWORK, STELLAR_HORIZON_URL, SOROBAN_RPC_URL
- ETHEREUM_RPC_URL, POLYGON_RPC_URL, BASE_RPC_URL (+ fallbacks)
- USDC/EURC token & bridge addresses

### Secrets (SENSITIVE - MUST ENCRYPT)
- JWT_SECRET, CONFIG_ENCRYPTION_KEY, WS_AUTH_SECRET
- CIRCLE_API_KEY, COINBASE_API_KEY/SECRET
- COINMARKETCAP_API_KEY, COINGECKO_API_KEY, ONEINCH_API_KEY
- DISCORD_BOT_TOKEN, SMTP_PASSWORD

### Feature Flags & Thresholds
- RATE_LIMIT_* (10+ variables)
- PRICE_DEVIATION_THRESHOLD, BRIDGE_SUPPLY_MISMATCH_THRESHOLD
- HEALTH_WEIGHT_* (5 weights)
- VALIDATION_* (8 variables)
- EXPORT_* (6 variables)
- LOG_* (8 variables)

## 2. Current Configuration Flow (CRITICAL GAPS)

```
.env → src/config/index.ts (Zod validation) → process.env (scattered)
    ↓
src/services/config.service.ts (in-memory only)
    ↓
src/api/routes/config.ts (basic CRUD, no audit)
```

**Issues:**
- ❌ NO PERSISTENCE (lost on restart)
- ❌ NO AUDIT TRAIL (who/when/why unknown)
- ❌ NO HIERARCHICAL RESOLUTION (env → global → default)
- ❌ NO VALIDATION SCHEMA (type-unsafe)
- ❌ NO ENCRYPTION (secrets in plaintext)
- ❌ NO CLUSTER INVALIDATION (cache incoherent)
- ❌ NO SAFE DEFAULTS (missing config crashes)
- ❌ NO BULK OPERATIONS (no atomic import/export)

## 3. Technology Stack (Confirmed)

| Component | Technology | Version | Location |
|-----------|-----------|---------|----------|
| ORM | Knex.js | 3.1.0 | `backend/src/database/connection.ts` |
| Database | PostgreSQL + TimescaleDB | - | `backend/src/database/schema.sql` |
| Validation | Zod | 3.23.8 | `backend/src/config/index.ts` |
| Cache | Redis (ioredis) | 5.4.1 | `backend/src/config/redis.ts` |
| API | Fastify | 5.8.4 | `backend/src/api/routes/` |
| Logging | Pino | 9.5.0 | `backend/src/utils/logger.ts` |

**Existing Config Tables (Migration 007):**
- `config_entries` (key-value store)
- `feature_flags` (feature toggles)
- `config_audit_logs` (basic audit)

## 4. Database Schema (NEW TABLES)

### `configs` Table
```sql
CREATE TABLE configs (
  id BIGSERIAL PRIMARY KEY,
  environment VARCHAR(64) NOT NULL CHECK (environment IN ('global', 'dev', 'staging', 'prod-us-east', 'prod-eu-west')),
  "key" VARCHAR(256) NOT NULL,
  value JSONB NOT NULL,
  encrypted BOOLEAN DEFAULT false,
  schema_name VARCHAR(128),
  validated BOOLEAN DEFAULT false,
  description TEXT,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by VARCHAR(128),
  changed_at TIMESTAMPTZ,
  UNIQUE(environment, "key")
);
CREATE INDEX configs_env_key ON configs(environment, "key");
CREATE INDEX configs_env_changed ON configs(environment, changed_at DESC);
```

### `config_audits` Table
```sql
CREATE TABLE config_audits (
  id BIGSERIAL PRIMARY KEY,
  config_id BIGINT REFERENCES configs(id) ON DELETE CASCADE,
  old_value JSONB,
  new_value JSONB NOT NULL,
  changed_by VARCHAR(128) NOT NULL,
  change_reason TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX config_audits_config ON config_audits(config_id);
```

## 5. Zod Validation Schemas

All 35 env vars will have Zod schemas:
- DATABASE_URL: z.string().url().startsWith('postgres://')
- KAFKA_BROKERS: z.array(z.string().url()).min(1)
- JWT_SECRET: z.string().min(32)
- API_KEYS: z.record(z.string(), z.string().min(16))
- MAX_RETRIES: z.number().int().min(1).max(10)
- ENABLE_FEATURES: z.record(z.string(), z.boolean())
- PRICE_DEVIATION_THRESHOLD: z.number().min(0).max(1)
- HEALTH_WEIGHT_*: z.number().min(0).max(1)
- etc.

## 6. Resolution Order (HIERARCHICAL)

1. **Environment-specific** → `configs WHERE environment=$env AND key=$key`
2. **Global fallback** → `configs WHERE environment='global' AND key=$key`
3. **Safe default** → `SAFE_DEFAULTS[key]` (embedded)
4. **Error** → throw if all missing

## 7. Admin API Endpoints

```
GET    /admin/configs/:environment?key=MAX_RETRIES
POST   /admin/configs (create/update with audit)
DELETE /admin/configs/:environment/:key
GET    /admin/configs/:environment/audit
POST   /admin/configs/export/:environment
POST   /admin/configs/import/:environment
```

## 8. Cache Strategy

- **TTL:** 5 minutes (300s)
- **Prefix:** `config:environment:key`
- **Invalidation:** Redis pub/sub on change
- **Cluster:** All instances subscribe to `config:changed` channel

## 9. Audit Trail Captures

Every change records:
- `config_id` — which config changed
- `old_value` — previous value (JSONB)
- `new_value` — new value (JSONB)
- `changed_by` — user/service account ID
- `change_reason` — "Deploy config update", "Manual admin change", etc.
- `changed_at` — timestamp with timezone

## 10. Safe Defaults (Embedded)

```typescript
export const SAFE_DEFAULTS: Record<ConfigKey, any> = {
  MAX_RETRIES: 3,
  ENABLE_BRIDGE_WATCH: false,
  LOG_LEVEL: 'info',
  RATE_LIMIT_MAX: 100,
  PRICE_DEVIATION_THRESHOLD: 0.02,
  BRIDGE_SUPPLY_MISMATCH_THRESHOLD: 0.1,
  // ... all 35 vars with sensible defaults
};
```

## 11. Bulk Import/Export

**Export:** `GET /admin/configs/export/prod-us-east` → JSON file
**Import:** `POST /admin/configs/import/prod-us-east` + JSON file → atomic transaction

## 12. Startup Validation

```typescript
const requiredConfigs = ['DATABASE_URL', 'KAFKA_BROKERS', 'JWT_SECRET'] as const;
for (const key of requiredConfigs) {
  try {
    await config.get(key, process.env.NODE_ENV!);
  } catch (e) {
    throw new Error(`Missing required config ${key}: ${e.message}`);
  }
}
```

## 13. Implementation Checklist

- [ ] Create migration: `023_config_service.ts`
- [ ] Create `services/config-service/validators.ts` (Zod schemas)
- [ ] Create `services/config-service/ConfigService.ts` (core logic)
- [ ] Create `services/config-service/defaults.ts` (safe defaults)
- [ ] Create `api/routes/admin/config.ts` (admin API)
- [ ] Create `scripts/import-configs.ts` (bulk import tool)
- [ ] Update `src/bootstrap.ts` (startup validation)
- [ ] Write 24 tests (95% coverage)
- [ ] Document in README

## 14. Deployment Environments

Supported environments:
- `global` — shared across all environments
- `dev` — development
- `staging` — staging
- `prod-us-east` — US East production
- `prod-eu-west` — EU West production

---

**APPROVAL REQUIRED BEFORE PROCEEDING TO IMPLEMENTATION**

Reviewer: _______________  
Date: _______________  
Comments: _______________
