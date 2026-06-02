import type { EnrichmentProviderAdapter, EnrichmentRecord } from "./types.js";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function hostFromUrl(value: unknown): string | null {
  const url = normalizeString(value);
  if (!url) return null;

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function severityWeight(severity: unknown): number {
  switch (normalizeString(severity)?.toLowerCase()) {
    case "critical":
      return 100;
    case "high":
      return 80;
    case "medium":
      return 50;
    case "low":
      return 20;
    default:
      return 50;
  }
}

function riskBand(weight: number): "critical" | "elevated" | "standard" {
  if (weight >= 90) return "critical";
  if (weight >= 70) return "elevated";
  return "standard";
}

export class IncidentMetadataAdapter implements EnrichmentProviderAdapter {
  name = "incident-metadata";

  supports(record: EnrichmentRecord): boolean {
    return record.recordType === "incident";
  }

  enrich(record: EnrichmentRecord) {
    const occurredAt = normalizeString(record.data.occurredAt);
    const sourceHost = hostFromUrl(record.data.sourceUrl);
    const assetCode = normalizeString(record.data.assetCode);
    const sourceType = normalizeString(record.data.sourceType) ?? "webhook";

    return {
      metadata: {
        provider: record.provider,
        recordType: record.recordType,
        sourceType,
        sourceExternalId: normalizeString(record.data.sourceExternalId),
        sourceHost,
        receivedAt: new Date().toISOString(),
        hasAssetCode: Boolean(assetCode),
      },
      derivedFields: {
        occurredAtIso: occurredAt,
        sourceHost,
        normalizedAssetCode: assetCode?.toUpperCase() ?? null,
      },
    };
  }
}

export class IncidentTaggingAdapter implements EnrichmentProviderAdapter {
  name = "incident-tagging";

  supports(record: EnrichmentRecord): boolean {
    return record.recordType === "incident";
  }

  enrich(record: EnrichmentRecord) {
    const tags = [
      `source:${normalizeString(record.data.sourceType) ?? "webhook"}`,
      `severity:${normalizeString(record.data.severity) ?? "medium"}`,
    ];

    const bridgeId = normalizeString(record.data.bridgeId);
    const assetCode = normalizeString(record.data.assetCode);
    const sourceHost = hostFromUrl(record.data.sourceUrl);

    if (bridgeId) tags.push(`bridge:${bridgeId}`);
    if (assetCode) {
      tags.push(`asset:${assetCode}`);
      if (["USDC", "USDT", "EURC", "DAI"].includes(assetCode.toUpperCase())) {
        tags.push("asset:stablecoin");
      }
    }
    if (sourceHost) tags.push(`source-host:${sourceHost}`);
    if (record.data.requiresManualReview === true) tags.push("workflow:manual-review");

    return {
      tags: tags.map(normalizeTag).filter(Boolean),
    };
  }
}

export class IncidentDerivedFieldsAdapter implements EnrichmentProviderAdapter {
  name = "incident-derived-fields";

  supports(record: EnrichmentRecord): boolean {
    return record.recordType === "incident";
  }

  enrich(record: EnrichmentRecord) {
    const weight = severityWeight(record.data.severity);
    const followUpActions = Array.isArray(record.data.followUpActions) ? record.data.followUpActions : [];
    const occurredAt = normalizeString(record.data.occurredAt);
    const occurredMs = occurredAt ? new Date(occurredAt).getTime() : Number.NaN;

    return {
      metadata: {
        severityWeight: weight,
        followUpActionCount: followUpActions.length,
      },
      derivedFields: {
        priorityScore: Math.min(100, weight + Math.min(20, followUpActions.length * 5)),
        riskBand: riskBand(weight),
        ageMs: Number.isNaN(occurredMs) ? null : Math.max(0, Date.now() - occurredMs),
      },
    };
  }
}

export function createDefaultEnrichmentAdapters(): EnrichmentProviderAdapter[] {
  return [
    new IncidentMetadataAdapter(),
    new IncidentTaggingAdapter(),
    new IncidentDerivedFieldsAdapter(),
  ];
}
