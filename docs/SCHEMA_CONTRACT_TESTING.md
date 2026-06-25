# Schema Contract Testing

## Overview
Schema contract tests verify that API responses keep matching the shape that
consumers depend on, over time. They live in [`tests/contracts/`](../tests/contracts/)
and run as part of the normal backend unit test suite (`npm run test:unit`,
and the root `npm test`), so they execute in CI on every push and pull request
alongside the rest of the backend tests — no separate workflow is needed.

This is distinct from [Schema Drift Handling](SCHEMA_DRIFT_HANDLING.md), which
detects drift in upstream provider payloads (Circle, CoinGecko, etc). Schema
contract tests are about **our own** API responses staying stable for the
clients that consume Bridge Watch.

## How it works
1. **Contract schemas** — [`tests/contracts/schemas.ts`](../tests/contracts/schemas.ts)
   defines a [Zod](https://zod.dev) schema per endpoint response. These schemas
   describe the public contract, independent of the Fastify route's internal
   JSON-schema validation.
2. **Breaking change detection** — [`tests/contracts/assertSchema.ts`](../tests/contracts/assertSchema.ts)
   parses the live response against the contract schema and throws a readable,
   per-field error (not a raw `ZodError` dump) if anything no longer matches —
   a field was removed, renamed, or changed type.
3. **Snapshots** — each test also calls `toMatchSnapshot()` on a representative
   payload. Snapshots live in `tests/contracts/__snapshots__/` and show up as a
   plain diff in the PR when a response shape changes, even for changes the
   Zod schema itself wouldn't catch (e.g. a new optional field).
4. **Coverage** — the suite covers representative endpoints: `GET /health`,
   `GET /api/v1/assets`, and the contract annotation endpoints introduced
   alongside this test suite. Extend coverage by adding a schema in
   `schemas.ts` and a test in `api.contract.test.ts` for each new key endpoint.

## Updating a contract
When a response shape changes on purpose:
1. Update the corresponding Zod schema in `tests/contracts/schemas.ts`.
2. Run `npx vitest run --config vitest.unit.config.ts -u` to refresh snapshots.
3. Call out the change explicitly in the PR description (and add a
   `BREAKING CHANGE:` footer per [CONTRIBUTING.md](../../CONTRIBUTING.md) if it
   breaks existing consumers).

If a contract test fails and the response change was **not** intentional, that
is the signal to fix the route/service instead of updating the schema.

## Running locally
```bash
cd backend
npm run test:unit -- tests/contracts
```
