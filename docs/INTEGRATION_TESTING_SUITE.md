# Integration Testing Suite

Integration tests cover service interactions, persistence, cache behavior, and API contracts.

## Coverage areas

- Database integration tests for Timescale/Postgres-backed models
- Redis-backed caching behavior and key lifecycle
- External API mocking for deterministic health/API behavior tests
- API route integration via Fastify `inject`
- Test data setup and cleanup through shared helpers

## Key test helpers

- `tests/helpers/db.ts`: migrations, rollback, truncation, cleanup
- `tests/helpers/redis.ts`: Redis database reset for isolation
- `tests/helpers/externalApiMock.ts`: deterministic fetch stubbing

## New integration tests

- `tests/integration/services/healthAndCache.integration.test.ts`
  - verifies degraded/healthy external API outcomes
  - validates health metrics endpoint output
  - validates Redis cache hit behavior

## Isolation and cleanup

- Database tables are truncated/cleaned between tests
- Redis `flushdb` is executed before each Redis integration test
- Global mocks are restored after each test

## CI execution

The `integration-tests.yml` workflow runs unit and integration suites separately, with Postgres and Redis service containers for integration jobs.

## Run locally

```bash
cd backend
npm run test:integration
```
