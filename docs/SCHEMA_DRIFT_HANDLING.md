# Schema Drift Handling

## Overview
Schema drift occurs when an upstream API provider (e.g., Circle, CoinGecko) changes the structure of their JSON response without notice. This can include:
- **Additions**: New fields added to the payload. Usually non-breaking but should be monitored.
- **Removals**: Existing fields removed from the payload. Usually breaking if the system depends on them.
- **Type Changes**: A field's data type changes (e.g., string to number). Usually breaking.

## Drift Detection
The `SchemaDriftService` automatically detects drift by comparing incoming raw payloads against a stored **Baseline Schema**.

### Baselines
Baselines are created automatically on the first successful fetch from a source. They are stored in the `schema_baselines` table.
Baselines can be manually updated via the API if a change is intended and accepted.

### Incidents
When drift is detected, an incident is recorded in the `schema_drift_incidents` table.
- **Breaking Drifts** (Removals, Type Changes) trigger **Critical Alerts**.
- **Non-breaking Drifts** (Additions) trigger **Warnings**.

## Monitoring & Alerting
- **API**: Reports are available at `GET /api/v1/schema-drift/report`.
- **Alerts**: Integrated into the `AlertService` under the `schema_drift` alert type.
- **Jobs**: A daily `schemaDriftJob` summarizes incidents and performs cleanup.

## How to Resolve Drift
1. **Analyze**: Check the drift report to see what changed.
2. **Fix Code**: If the drift is breaking, update the corresponding service or normalization logic.
3. **Update Baseline**: Once the code is updated, or if the change is accepted as is, update the baseline using:
   `POST /api/v1/schema-drift/baseline/:sourceName` with a sample of the new payload.
4. **Resolve Incident**: Mark the incident as resolved via the API:
   `POST /api/v1/schema-drift/resolve/:id`.

## Configuration
- Retention policy for resolved incidents: 30 days (managed by `schemaDriftJob`).
