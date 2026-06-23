# API Fixture Validation

> **See also:** [Fixture Audit Report](../../docs/FIXTURE_AUDIT_REPORT.md) for the full inventory of reusable test fixtures, ownership, and CI alignment across the monorepo.

Test fixtures (the static JSON payloads under `e2e/fixtures/`) are easy to forget
when an API response shape changes. When they drift, tests pass against payloads
that no longer resemble what the API actually returns. The fixture validator
guards against this by checking every registered fixture against a schema that
mirrors the current API/domain shape.

## What it checks

- **Fixture drift** — fields that have been added, removed, or renamed in the API
  but not in the fixture.
- **Schema matching** — types and enum values match the current shapes defined in
  `frontend/src/types`.
- **Readable diffs** — each mismatch is reported with the exact path
  (e.g. `USDC.factors.liquidityDepth`) and a description.

Findings are classified by severity:

| Severity | Meaning | Fails CI? |
| --- | --- | --- |
| `error` | Missing/mistyped required field, bad enum, unreadable/invalid JSON | Yes |
| `warning` | A property that is no longer part of the current API shape | Only with `--strict` |

## Running it

```bash
# From the repo root
npm --workspace=backend run fixtures:validate

# Treat warnings (stale extra fields) as failures too
npm --workspace=backend run fixtures:validate -- --strict

# Machine-readable output
npm --workspace=backend run fixtures:validate -- --json
```

The command exits non-zero when there are errors (or any findings under
`--strict`), which is what makes it usable as a CI gate. It runs in the `node-ci`
job in `.github/workflows/ci.yml`, right after linting.

The same checks also run as part of the backend unit test suite
(`tests/testing/fixtureValidator.test.ts`), so `npm --workspace=backend run test`
will fail if a fixture drifts.

## Updating fixtures when the API changes

1. Update the schema in
   `backend/src/testing/fixtureValidator/schemas.ts` to reflect the new API shape
   (keep it aligned with the canonical types in `frontend/src/types`).
2. Run `npm --workspace=backend run fixtures:validate`. The report lists every
   fixture and field that no longer matches.
3. Update the offending fixture JSON in `e2e/fixtures/` to match.
4. Re-run the validator until it reports **PASS**.

## Adding a new fixture

1. Add the fixture file under `e2e/fixtures/`.
2. Add a schema describing its shape to `schemas.ts`.
3. Register the fixture in
   `backend/src/testing/fixtureValidator/registry.ts` with its file path, schema,
   and a short description of the API surface it represents.

That's it — the new fixture is now covered by both the CLI check and the test
suite.

## Relationship to E2E runtime mocks

The JSON files in `e2e/fixtures/` are validated against API schemas in CI, but
Playwright E2E tests currently build mocked responses from programmatic factories
in `frontend/src/test/factories.ts` via `e2e/utils/mockApi.ts` — they do not
load the JSON files directly. When updating fixtures, align both the JSON
payloads and the E2E factory defaults, or consult the
[Fixture Audit Report](../../docs/FIXTURE_AUDIT_REPORT.md) for the current
consolidation plan.
