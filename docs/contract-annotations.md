# Contract Data Annotations

## Overview
Annotations let operators and auditors attach short, timestamped notes to contract
data — for example recording why a reserve threshold was adjusted, or flagging a
known anomaly during an incident. Annotations are read-only context: they never
change the underlying contract data, they only add a human-readable trail next to it.

Annotations are backed by the existing `service_annotations` table (see
[`028_service_annotations.ts`](../src/database/migrations/028_service_annotations.ts))
and exposed for contracts through a dedicated, contract-scoped route. Every
annotation is also written to `service_annotation_audit`, so the full history
of who created, updated, or deleted an annotation is preserved.

## Semantics
- **Storage**: each annotation is stored with `entityType="contract"` and
  `entityId=<contractAddress>`, scoping it to a single contract.
- **Timestamps**: `createdAt` / `updatedAt` are set automatically. The optional
  `startTime` / `endTime` fields describe the window the annotation applies to
  (e.g. an incident window), independent of when the annotation itself was written.
- **Author info**: every annotation requires an `author` (the operator or
  auditor who wrote it). Updates and deletes are attributed to an `actor` and
  recorded in the audit log.
- **Read access**: annotations for a contract are publicly readable via `GET`
  so any operator or auditor reviewing the contract can see prior context.
  Writes (`POST`) require an `author`; there is no implicit anonymous write.

## API

### Create an annotation
```
POST /api/v1/contracts/:contractAddress/annotations
{
  "content": "Reserve threshold lowered ahead of the v2 migration window",
  "author": "ops@bridgewatch",
  "startTime": "2026-06-20T00:00:00Z",
  "endTime": "2026-06-27T00:00:00Z"
}
```
Returns `201` with the created annotation, or `400` if `content`/`author` are missing.

### Read annotations for a contract
```
GET /api/v1/contracts/:contractAddress/annotations
GET /api/v1/contracts/:contractAddress/annotations?active=true&author=ops@bridgewatch
```
Returns `200` with an array of annotations for that contract, newest first.
Optional query params filter by `active` status and `author`.

## Relationship to the generic annotation API
The contract routes are a thin convenience layer over the generic
`/api/v1/service-annotations` endpoints (update, delete, and audit-log lookup
by annotation `id` are still available there). Use the contract-scoped routes
when you only care about one contract; use the generic routes when you need
to update/delete a specific annotation or inspect its audit trail.
