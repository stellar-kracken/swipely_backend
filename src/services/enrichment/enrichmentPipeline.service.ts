import { retryPolicyService, type RetryPolicyService } from "../retryPolicy.service.js";
import type {
  EnrichmentPatch,
  EnrichmentProviderAdapter,
  EnrichmentRecord,
  EnrichmentResult,
  EnrichmentValidationResult,
} from "./types.js";
import { createDefaultEnrichmentAdapters } from "./providerAdapters.js";

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags.filter(Boolean))).sort();
}

function mergePatch(target: EnrichmentPatch, patch: EnrichmentPatch): EnrichmentPatch {
  return {
    metadata: {
      ...(target.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
    tags: uniqueTags([...(target.tags ?? []), ...(patch.tags ?? [])]),
    derivedFields: {
      ...(target.derivedFields ?? {}),
      ...(patch.derivedFields ?? {}),
    },
  };
}

export class EnrichmentValidationError extends Error {
  constructor(public readonly validation: EnrichmentValidationResult) {
    super("Enrichment validation failed");
  }
}

export class EnrichmentPipelineService {
  constructor(
    private readonly adapters: EnrichmentProviderAdapter[] = createDefaultEnrichmentAdapters(),
    private readonly retryPolicy: RetryPolicyService = retryPolicyService,
  ) {}

  async enrich<TData extends Record<string, unknown>>(record: EnrichmentRecord<TData>): Promise<EnrichmentResult<TData>> {
    const adapters = this.adapters.filter((adapter) => adapter.supports(record));
    let patch: EnrichmentPatch = { metadata: {}, tags: [], derivedFields: {} };
    let attempts = 0;

    for (const adapter of adapters) {
      const adapterPatch = await this.runAdapterWithRetry(adapter, record);
      attempts += adapterPatch.attempts;
      patch = mergePatch(patch, adapterPatch.patch);
    }

    const result: EnrichmentResult<TData> = {
      record,
      metadata: patch.metadata ?? {},
      tags: uniqueTags(patch.tags ?? []),
      derivedFields: patch.derivedFields ?? {},
      validation: { valid: true, issues: [] },
      attempts,
    };

    result.validation = this.validate(result);
    if (!result.validation.valid) {
      throw new EnrichmentValidationError(result.validation);
    }

    return result;
  }

  validate(result: Pick<EnrichmentResult, "metadata" | "tags" | "derivedFields">): EnrichmentValidationResult {
    const issues: EnrichmentValidationResult["issues"] = [];

    if (!result.metadata || typeof result.metadata !== "object" || Array.isArray(result.metadata)) {
      issues.push({ field: "metadata", code: "invalid_metadata", message: "Metadata must be an object" });
    }

    if (!Array.isArray(result.tags)) {
      issues.push({ field: "tags", code: "invalid_tags", message: "Tags must be an array" });
    } else {
      result.tags.forEach((tag, index) => {
        if (typeof tag !== "string" || !/^[a-z0-9:_-]+$/.test(tag)) {
          issues.push({ field: `tags.${index}`, code: "invalid_tag", message: "Tags must be normalized strings" });
        }
      });
    }

    if (!result.derivedFields || typeof result.derivedFields !== "object" || Array.isArray(result.derivedFields)) {
      issues.push({ field: "derivedFields", code: "invalid_derived_fields", message: "Derived fields must be an object" });
    }

    return { valid: issues.length === 0, issues };
  }

  private async runAdapterWithRetry<TData extends Record<string, unknown>>(
    adapter: EnrichmentProviderAdapter<TData>,
    record: EnrichmentRecord<TData>,
  ): Promise<{ patch: EnrichmentPatch; attempts: number }> {
    const policy = this.retryPolicy.getPolicy({ operation: `enrichment.${adapter.name}`, maxRetries: 2, baseDelayMs: 25 });
    let attempt = 0;

    while (attempt <= policy.maxRetries) {
      attempt += 1;
      try {
        return { patch: await adapter.enrich(record), attempts: attempt };
      } catch (error) {
        const failureClass = this.retryPolicy.classifyFailure(error);
        const exhausted = attempt > policy.maxRetries || !this.retryPolicy.isRetryable(error);
        this.retryPolicy.recordRetryMetric(
          `enrichment.${adapter.name}`,
          exhausted ? "exhausted" : "scheduled",
          attempt,
          failureClass,
        );

        if (exhausted) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.retryPolicy.getDelayMs(attempt, policy)));
      }
    }

    return { patch: {}, attempts: attempt };
  }
}

export const enrichmentPipelineService = new EnrichmentPipelineService();
