# Data Enrichment Pipeline

Incoming records are enriched before persistence so stored data carries source metadata, rule-based tags, and derived fields that downstream search, alerting, and review workflows can use.

## Flow

1. Ingestion normalizes an incoming payload into the service-specific record shape.
2. The enrichment pipeline selects provider adapters that support the record type.
3. Each adapter returns a patch containing `metadata`, `tags`, and/or `derivedFields`.
4. The pipeline merges patches, validates the final enrichment output, and retries transient adapter failures.
5. The enriched record is stored with explicit enrichment columns and embedded source attribution.

For bridge incidents, enrichment runs in `IncidentIngestionService.ingest()` before duplicate checks, incident inserts, review queue writes, and ingestion history writes.

## Incident Enrichment

The default incident adapters add:

- Metadata: provider, record type, source type, source external ID, source host, receipt timestamp, asset presence, severity weight, and follow-up action count.
- Tags: source, severity, bridge, asset, stablecoin classification, source host, and manual-review workflow tags.
- Derived fields: normalized asset code, source host, occurred-at ISO value, priority score, risk band, and age in milliseconds.

Persisted incident fields:

- `bridge_incidents.enrichment_metadata`
- `bridge_incidents.enrichment_tags`
- `bridge_incidents.derived_fields`
- `bridge_incidents.enrichment_validation`
- `bridge_incident_review_queue.enriched_payload`
- `bridge_incident_ingestion_history.enrichment_metadata`
- `bridge_incident_ingestion_history.enrichment_tags`
- `bridge_incident_ingestion_history.derived_fields`

## Provider Adapters

Adapters implement `EnrichmentProviderAdapter` and can be added to `createDefaultEnrichmentAdapters()`:

```ts
export interface EnrichmentProviderAdapter {
  name: string;
  supports(record: EnrichmentRecord): boolean;
  enrich(record: EnrichmentRecord): Promise<EnrichmentPatch> | EnrichmentPatch;
}
```

Adapters should keep external lookups narrow and return only enrichment patches. The pipeline owns retries, merging, and validation.

## Validation And Retries

Validation requires:

- `metadata` is an object.
- `tags` is an array of normalized strings matching `^[a-z0-9:_-]+$`.
- `derivedFields` is an object.

Adapter failures are classified by `RetryPolicyService`. Transient, timeout, and rate-limit failures are retried with exponential backoff and jitter; permanent failures are surfaced immediately.
