# Backend Testing Guide

## Overview

This project uses [Vitest](https://vitest.dev/) with two separate test projects:

| Type | Location | Needs DB? |
|------|----------|-----------|
| Unit | `tests/{api,services,workers,jobs}` | No — all external deps are mocked |
| Integration | `tests/integration/` | Yes — real Postgres + Redis |

---

## Running tests

### Unit tests (no database required)
```bash
npm run test:unit
```

### Integration tests (requires Postgres + Redis)
```bash
# Start services first
docker compose up -d postgres redis

# Run integration tests
npm run test:integration
```

### All tests
```bash
npm run test
```

### With coverage
```bash
npm run test:coverage
```

---

## Integration test setup

Integration tests use a dedicated `bridge_watch_test` database. The setup file
(`tests/integration/setup.ts`) automatically:
- Runs all migrations before the suite starts
- Rolls back all migrations after the suite finishes

Each test file truncates only the tables it needs in `beforeEach` to keep
tests isolated and fast.

---

## Test helpers

### `tests/helpers/db.ts`
| Function | Description |
|----------|-------------|
| `runMigrations(db)` | Runs all pending migrations |
| `rollbackAll(db)` | Rolls back all migrations |
| `truncateTables(db, tables)` | Truncates specific tables, disabling FK checks |
| `cleanDatabase(db)` | Truncates all known tables |

### `tests/factories/index.ts`
| Factory | Description |
|---------|-------------|
| `createAsset(db, overrides?)` | Inserts an asset row |
| `createBridge(db, overrides?)` | Inserts a bridge row |
| `createAlertRule(db, overrides?)` | Inserts an alert rule row |
| `createPriceRecord(db, overrides?)` | Inserts a price record |
| `createHealthScore(db, overrides?)` | Inserts a health score record |

All factories accept an optional `overrides` object to customize any field.

---

## Writing new integration tests

1. Create your file under `tests/integration/`
2. Import helpers and factories you need
3. Truncate relevant tables in `beforeEach`
4. Use factories to seed data, then call the API or DB directly
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { getDatabase } from "../../../src/database/connection.js";
import { truncateTables } from "../../helpers/db.js";
import { createBridge } from "../../factories/index.js";

describe("My integration test", () => {
  beforeEach(async () => {
    await truncateTables(getDatabase(), ["bridges"]);
  });

  it("does something real", async () => {
    const db = getDatabase();
    const bridge = await createBridge(db, { name: "circle" });
    const row = await db("bridges").where({ id: bridge.id }).first();
    expect(row.name).toBe("circle");
  });
});
```

---

## CI/CD

The GitHub Actions workflow (`.github/workflows/integration-tests.yml`) runs:
- **Unit tests** on every push/PR — no services needed
- **Integration tests** on every push/PR — spins up Postgres (TimescaleDB) and Redis as service containers

Coverage reports are uploaded as artifacts after each run.
