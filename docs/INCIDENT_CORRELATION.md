# Incident Correlation Service

This document describes the Incident Correlation Service implemented in backend/src/services/correlation.service.ts.

## Algorithm
- Compute similarity between incidents using multiple signals:
  - normalized_fingerprint exact match (weight 0.6)
  - bridge_id match (0.15)
  - asset_code match (0.05)
  - severity match (0.03)
  - timestamp overlap within 1 hour (0.07)
  - textual similarity (Jaccard on tokens of title+description, scaled to max 0.2)
- Scores are summed and clamped to [0,1]. Default suggestion threshold is controlled by env CORRELATION_THRESHOLD (default 0.6).

## Configuration
- CORRELATION_THRESHOLD (0-1) — threshold above which automated suggestions are created.

## API Endpoints
- GET /api/v1/incidents/:id/correlations/suggestions?lookbackHours=24
  - Returns suggested incident ids with score and reasons.
- POST /api/v1/incidents/:id/correlations/link
  - Body: { targetIncidentId: string, actor?: string }
  - Requires admin/operator scope.
- POST /api/v1/incidents/:id/correlations/unlink
  - Body: { targetIncidentId: string, actor?: string }
  - Requires admin/operator scope.
- POST /api/v1/incidents/:id/correlations/approve
  - Body: { targetIncidentId: string, actor?: string }
  - Approves a suggestion (creates a group and links incidents).
- GET /api/v1/incidents/:id/correlations/group
  - Returns the correlation group and members for the given incident.

## Audit Trail
- All suggestions, links, unlinks and approvals are written to incident_correlation_audit table with actor and metadata.

## Notes
- The algorithm is deterministic and tunable via CORRELATION_THRESHOLD.
- Suggestions are recorded for audit but not automatically merged without approval.
