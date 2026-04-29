# Configuration Service Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Application Bootstrap                        │
│  (src/bootstrap.ts - Startup Validation)                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ConfigService                                 │
│  (services/config-service/ConfigService.ts)                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ get<K>(key: K, environment: string): Promise<Value<K>>  │  │
│  │                                                          │  │
│  │  1. Check Redis cache (TTL: 5min)                       │  │
│  │  2. Query DB: environment-specific config              │  │
│  │  3. Query DB: global config (fallback)                 │  │
│  │  4. Return safe default (embedded)                     │  │
│  │  5. Throw error if all missing                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ set(key, value, metadata): Promise<void>                │  │
│  │                                                          │  │
│  │  1. Validate value with Zod schema                      │  │
│  │  2. Encrypt if sensitive                                │  │
│  │  3. Upsert into configs table (transaction)             │  │
│  │  4. Log old→new in config_audits (transaction)          │  │
│  │  5. Invalidate Redis cache                              │  │
│  │  6. Publish config:changed event (pub/sub)              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ invalidate(environment, key?): Promise<void>            │  │
│  │                                                          │  │
│  │  1. Delete Redis keys matching pattern                  │  │
│  │  2. Publish config:changed to all instances             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    ┌─────────┐          ┌─────────┐         ┌──────────┐
    │  Redis  │          │PostgreSQL│        │ Zod      │
    │ Cache   │          │ Database │        │Validators│
    │ (5min   │          │          │        │          │
    │  TTL)   │          │ configs  │        │ 35 keys  │
    │         │          │ config_  │        │ schemas  │
    │ Pub/Sub │          │ audits   │        │          │
    └─────────┘          └─────────┘        └──────────┘
```

## Data Flow: Get Configuration

```
Application Code
    │
    ├─ await config.get('MAX_RETRIES', 'prod-us-east')
    │
    ▼
ConfigService.get()
    │
    ├─ Check Redis: config:prod-us-east:MAX_RETRIES
    │  ├─ HIT (99% case) → Return cached value (sub-ms)
    │  └─ MISS → Continue
    │
    ├─ Query DB: SELECT * FROM configs
    │           WHERE environment='prod-us-east' AND key='MAX_RETRIES'
    │  ├─ FOUND → Validate with Zod, cache, return
    │  └─ NOT FOUND → Continue
    │
    ├─ Query DB: SELECT * FROM configs
    │           WHERE environment='global' AND key='MAX_RETRIES'
    │  ├─ FOUND → Validate with Zod, cache, return
    │  └─ NOT FOUND → Continue
    │
    ├─ Check SAFE_DEFAULTS['MAX_RETRIES']
    │  ├─ FOUND → Return default (3)
    │  └─ NOT FOUND → Continue
    │
    └─ Throw Error: "No configuration for MAX_RETRIES"
```

## Data Flow: Set Configuration (with Audit)

```
Admin API: POST /admin/configs
    │
    ├─ Body: { environment: 'prod-us-east', key: 'MAX_RETRIES', value: 5, changeReason: 'Increase for peak load' }
    │
    ▼
ConfigService.set()
    │
    ├─ Validate value with Zod schema
    │  └─ If invalid → Throw error
    │
    ├─ Encrypt if sensitive (JWT_SECRET, API_KEYS, etc.)
    │
    ├─ Start DB transaction
    │  │
    │  ├─ Query existing config
    │  │  └─ If exists → Record old_value for audit
    │  │
    │  ├─ Upsert into configs table
    │  │  ├─ INSERT if new
    │  │  └─ UPDATE if exists
    │  │
    │  ├─ INSERT into config_audits
    │  │  ├─ config_id: <id>
    │  │  ├─ old_value: 3 (previous)
    │  │  ├─ new_value: 5 (new)
    │  │  ├─ changed_by: 'admin@example.com'
    │  │  ├─ change_reason: 'Increase for peak load'
    │  │  └─ changed_at: NOW()
    │  │
    │  └─ COMMIT transaction
    │
    ├─ Invalidate Redis cache
    │  └─ DEL config:prod-us-east:MAX_RETRIES
    │
    ├─ Publish config:changed event
    │  └─ PUBLISH config:changed { environment: 'prod-us-east', key: 'MAX_RETRIES', timestamp: '2026-04-28T...' }
    │
    └─ Return 201 Created
```

## Cluster Invalidation (Multi-Instance)

```
Instance A (Admin API)
    │
    ├─ POST /admin/configs
    │  └─ ConfigService.set()
    │     └─ PUBLISH config:changed
    │
    ▼
Redis Pub/Sub Channel: config:changed
    │
    ├─ Instance A (subscriber)
    │  └─ Invalidate local cache
    │
    ├─ Instance B (subscriber)
    │  └─ Invalidate local cache
    │
    └─ Instance C (subscriber)
       └─ Invalidate local cache

Result: All instances have fresh cache within milliseconds
```

## Database Schema

```
┌─────────────────────────────────────────────────────────────┐
│                        configs                              │
├─────────────────────────────────────────────────────────────┤
│ id (BIGSERIAL PRIMARY KEY)                                  │
│ environment (VARCHAR(64)) ──┐                               │
│ key (VARCHAR(256))          ├─ UNIQUE constraint            │
│ value (JSONB)               │                               │
│ encrypted (BOOLEAN)         │                               │
│ schema_name (VARCHAR(128))  │                               │
│ validated (BOOLEAN)         │                               │
│ description (TEXT)          │                               │
│ created_by (VARCHAR(128))   │                               │
│ created_at (TIMESTAMPTZ)    │                               │
│ changed_by (VARCHAR(128))   │                               │
│ changed_at (TIMESTAMPTZ)    │                               │
│                                                             │
│ Indexes:                                                    │
│ - configs_env_key (environment, key)                        │
│ - configs_env_changed (environment, changed_at DESC)        │
└─────────────────────────────────────────────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    config_audits                            │
├─────────────────────────────────────────────────────────────┤
│ id (BIGSERIAL PRIMARY KEY)                                  │
│ config_id (BIGINT FK → configs.id)                          │
│ old_value (JSONB)                                           │
│ new_value (JSONB)                                           │
│ changed_by (VARCHAR(128))                                   │
│ change_reason (TEXT)                                        │
│ changed_at (TIMESTAMPTZ)                                    │
│                                                             │
│ Indexes:                                                    │
│ - config_audits_config (config_id)                          │
└─────────────────────────────────────────────────────────────┘
```

## Validation Pipeline

```
Input Value
    │
    ▼
Zod Schema Validation
    │
    ├─ Type check (string, number, boolean, array, object)
    ├─ Format check (URL, email, UUID, etc.)
    ├─ Range check (min, max, length)
    ├─ Custom refinements (e.g., startsWith('postgres://'))
    │
    ├─ VALID → Continue
    └─ INVALID → Throw ZodError
    │
    ▼
Encryption (if sensitive)
    │
    ├─ Check if key in SENSITIVE_KEYS list
    ├─ If yes → Encrypt with CONFIG_ENCRYPTION_KEY
    └─ If no → Store plaintext
    │
    ▼
Database Insert/Update
    │
    └─ Store in configs table with validated=true
```

## Hierarchical Resolution Example

```
Request: config.get('MAX_RETRIES', 'prod-us-east')

Step 1: Environment-Specific
    SELECT * FROM configs
    WHERE environment='prod-us-east' AND key='MAX_RETRIES'
    Result: Found (value=5) → Return 5 ✓

Request: config.get('CUSTOM_FEATURE', 'prod-us-east')

Step 1: Environment-Specific
    SELECT * FROM configs
    WHERE environment='prod-us-east' AND key='CUSTOM_FEATURE'
    Result: Not found → Continue

Step 2: Global Fallback
    SELECT * FROM configs
    WHERE environment='global' AND key='CUSTOM_FEATURE'
    Result: Found (value=true) → Return true ✓

Request: config.get('UNKNOWN_KEY', 'prod-us-east')

Step 1: Environment-Specific
    Result: Not found → Continue

Step 2: Global Fallback
    Result: Not found → Continue

Step 3: Safe Default
    SAFE_DEFAULTS['UNKNOWN_KEY']
    Result: Not found → Continue

Step 4: Error
    Throw Error: "No configuration for UNKNOWN_KEY" ✗
```

## Admin API Endpoints

```
GET /admin/configs/:environment
    ├─ Query all configs for environment
    └─ Response: [{ id, key, value, encrypted, validated, ... }]

GET /admin/configs/:environment?key=MAX_RETRIES
    ├─ Query specific config
    └─ Response: { id, key, value, encrypted, validated, ... }

POST /admin/configs
    ├─ Body: { environment, key, value, schemaName, description, changeReason }
    ├─ Validate value with Zod
    ├─ Upsert into configs
    ├─ Log to config_audits
    ├─ Invalidate cache
    └─ Response: 201 Created

DELETE /admin/configs/:environment/:key
    ├─ Delete from configs
    ├─ Log deletion to config_audits
    ├─ Invalidate cache
    └─ Response: 200 OK

GET /admin/configs/:environment/audit?key=MAX_RETRIES&limit=50
    ├─ Query config_audits for specific config
    └─ Response: [{ id, old_value, new_value, changed_by, change_reason, changed_at }]

POST /admin/configs/export/:environment
    ├─ Export all configs for environment as JSON
    └─ Response: { configs: { key1: value1, key2: value2, ... } }

POST /admin/configs/import/:environment
    ├─ Body: { configs: { key1: value1, key2: value2, ... }, importReason }
    ├─ Validate all values with Zod
    ├─ Upsert all in transaction
    ├─ Log all changes to config_audits
    ├─ Invalidate cache
    └─ Response: 201 Created
```

## Cache Invalidation Strategy

```
Scenario: Update MAX_RETRIES in prod-us-east

1. Admin updates config via API
   POST /admin/configs
   { environment: 'prod-us-east', key: 'MAX_RETRIES', value: 5 }

2. ConfigService.set() executes
   ├─ Validate & store in DB
   ├─ Log to audit table
   ├─ Invalidate Redis: DEL config:prod-us-east:MAX_RETRIES
   └─ Publish: PUBLISH config:changed { environment: 'prod-us-east', key: 'MAX_RETRIES' }

3. All instances receive pub/sub event
   ├─ Instance A: Invalidate config:prod-us-east:MAX_RETRIES
   ├─ Instance B: Invalidate config:prod-us-east:MAX_RETRIES
   └─ Instance C: Invalidate config:prod-us-east:MAX_RETRIES

4. Next request for MAX_RETRIES
   ├─ Cache miss (just invalidated)
   ├─ Query DB: SELECT * FROM configs WHERE environment='prod-us-east' AND key='MAX_RETRIES'
   ├─ Get fresh value: 5
   ├─ Cache for 5 minutes
   └─ Return to application

Result: Zero-downtime config update across cluster
```

## Safe Defaults Fallback

```
Application requests: config.get('LOG_LEVEL', 'dev')

Scenario 1: Config exists in DB
    ├─ Cache hit → Return cached value
    └─ Result: 'debug' (from DB)

Scenario 2: Config missing from DB
    ├─ Cache miss
    ├─ DB query returns null
    ├─ Check SAFE_DEFAULTS['LOG_LEVEL']
    ├─ Found: 'info'
    └─ Result: 'info' (safe default)

Scenario 3: Config missing AND no safe default
    ├─ Cache miss
    ├─ DB query returns null
    ├─ Check SAFE_DEFAULTS['UNKNOWN_KEY']
    ├─ Not found
    └─ Throw Error: "No configuration for UNKNOWN_KEY"

Benefit: Application never crashes due to missing config
         Falls back to sensible defaults automatically
```

## Encryption for Sensitive Values

```
Sensitive Keys (MUST ENCRYPT):
- JWT_SECRET
- CONFIG_ENCRYPTION_KEY
- WS_AUTH_SECRET
- CIRCLE_API_KEY
- COINBASE_API_KEY
- COINBASE_API_SECRET
- COINMARKETCAP_API_KEY
- COINGECKO_API_KEY
- ONEINCH_API_KEY
- DISCORD_BOT_TOKEN
- SMTP_PASSWORD

Flow:
1. Admin sets JWT_SECRET via API
   POST /admin/configs
   { key: 'JWT_SECRET', value: 'secret-key-here' }

2. ConfigService.set() detects sensitive key
   ├─ Check if key in SENSITIVE_KEYS list
   ├─ Encrypt value with CONFIG_ENCRYPTION_KEY
   └─ Store encrypted value in DB

3. Admin retrieves JWT_SECRET
   GET /admin/configs/prod-us-east?key=JWT_SECRET

4. ConfigService.get() detects encrypted value
   ├─ Query DB: SELECT * FROM configs WHERE key='JWT_SECRET'
   ├─ Check encrypted=true flag
   ├─ Decrypt value with CONFIG_ENCRYPTION_KEY
   └─ Return plaintext to application

Result: Secrets encrypted at rest in database
        Decrypted only when needed by application
```

---

**Architecture designed for:**
- ✅ Zero-downtime deployments
- ✅ Full audit trail
- ✅ Hierarchical resolution
- ✅ Cluster coherence
- ✅ Type safety
- ✅ Encryption at rest
- ✅ Safe defaults
- ✅ Performance (sub-ms cache hits)
