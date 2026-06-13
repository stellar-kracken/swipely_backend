export type EnrichmentRecordType = "incident" | "transaction" | "asset" | "bridge" | string;

export interface EnrichmentRecord<TData extends Record<string, unknown> = Record<string, unknown>> {
  recordType: EnrichmentRecordType;
  provider: string;
  data: TData;
  context?: Record<string, unknown>;
}

export interface EnrichmentPatch {
  metadata?: Record<string, unknown>;
  tags?: string[];
  derivedFields?: Record<string, unknown>;
}

export interface EnrichmentValidationIssue {
  field: string;
  code: string;
  message: string;
}

export interface EnrichmentValidationResult {
  valid: boolean;
  issues: EnrichmentValidationIssue[];
}

export interface EnrichmentResult<TData extends Record<string, unknown> = Record<string, unknown>> {
  record: EnrichmentRecord<TData>;
  metadata: Record<string, unknown>;
  tags: string[];
  derivedFields: Record<string, unknown>;
  validation: EnrichmentValidationResult;
  attempts: number;
}

export interface EnrichmentProviderAdapter<TData extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  supports(record: EnrichmentRecord<TData>): boolean;
  enrich(record: EnrichmentRecord<TData>): Promise<EnrichmentPatch> | EnrichmentPatch;
}
