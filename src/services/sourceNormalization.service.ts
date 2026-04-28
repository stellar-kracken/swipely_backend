// Source Normalization Service
// Normalizes provider-specific payloads into a canonical internal format.
// Provides adapters, validation, error reporting, and versioned mappings.

import { logger } from "../utils/logger.js";
import { getDatabase } from "../database/connection.js";
import Ajv from "ajv";

/**
 * Canonical data shape for normalized source data.
 */
export interface NormalizedSource {
  /** Unique identifier for the source record */
  id: string;
  /** Provider name, e.g., "stellar", "soroban" */
  provider: string;
  /** Version of the mapping used for this payload */
  version: string;
  /** Normalized fields common across providers */
  assetCode: string;
  assetIssuer: string;
  amount: number;
  timestamp: Date;
  /** Arbitrary extra data that does not have a canonical representation */
  raw: Record<string, unknown>;
}

/**
 * Interface that each provider adapter must implement.
 */
export interface ProviderAdapter {
  /** Provider identifier string */
  provider: string;
  /** Version string for this adapter implementation */
  version: string;
  /** Validate raw payload against provider‑specific schema */
  validate(payload: unknown): boolean;
  /** Transform raw payload into NormalizedSource */
  normalize(payload: unknown): NormalizedSource;
}

/**
 * Simple JSON‑Schema validator using AJV.
 */
class SchemaValidator {
  private ajv = new Ajv({ allErrors: true, strict: false });
  compile(schema: object) {
    return this.ajv.compile(schema);
  }
}

/**
 * Registry that holds all adapters and allows lookup by provider & version.
 */
class AdapterRegistry {
  private adapters: Map<string, ProviderAdapter> = new Map();

  register(adapter: ProviderAdapter) {
    const key = this.key(adapter.provider, adapter.version);
    if (this.adapters.has(key)) {
      logger.warn({ provider: adapter.provider, version: adapter.version }, "Adapter already registered – overwriting");
    }
    this.adapters.set(key, adapter);
    logger.info({ provider: adapter.provider, version: adapter.version }, "Adapter registered");
  }

  get(provider: string, version: string): ProviderAdapter | undefined {
    return this.adapters.get(this.key(provider, version));
  }

  private key(provider: string, version: string) {
    return `${provider}:${version}`;
  }
}

/**
 * Global singleton registry instance.
 */
export const adapterRegistry = new AdapterRegistry();

/**
 * Service responsible for normalizing incoming payloads.
 * It looks up the appropriate adapter, validates the payload, and persists the normalized
 * representation. Errors are reported via logger and returned to the caller.
 */
export class SourceNormalizationService {
  private static instance: SourceNormalizationService;
  private validator = new SchemaValidator();

  private constructor() {}

  public static getInstance(): SourceNormalizationService {
    if (!SourceNormalizationService.instance) {
      SourceNormalizationService.instance = new SourceNormalizationService();
    }
    return SourceNormalizationService.instance;
  }

  /**
   * Normalizes a raw payload.
   * @param provider Provider name (e.g., "stellar")
   * @param version  Mapping version to use (allows evolution without breaking existing data)
   * @param payload  Raw incoming data from the provider
   * @returns NormalizedSource on success
   * @throws Error with details when validation or transformation fails
   */
  public async normalize(provider: string, version: string, payload: unknown): Promise<NormalizedSource> {
    const adapter = adapterRegistry.get(provider, version);
    if (!adapter) {
      const err = `No adapter registered for provider='${provider}' version='${version}'`;
      logger.error({ provider, version }, err);
      throw new Error(err);
    }

    // Provider‑specific validation (schema or custom logic)
    if (!adapter.validate(payload)) {
      const err = `Payload validation failed for provider='${provider}' version='${version}'`;
      logger.error({ provider, version, payload }, err);
      throw new Error(err);
    }

    // Normalization step – may still throw if unexpected fields are missing
    let normalized: NormalizedSource;
    try {
      normalized = adapter.normalize(payload);
    } catch (e) {
      const err = `Adapter normalization error for provider='${provider}' version='${version}': ${e instanceof Error ? e.message : String(e)}`;
      logger.error({ provider, version, payload, error: e }, err);
      throw new Error(err);
    }

    // Persist the normalized record – this is optional but useful for downstream services
    await this.persist(normalized);
    return normalized;
  }

  /** Persist a normalized source record using the shared DB connection. */
  private async persist(record: NormalizedSource) {
    const db = getDatabase();
    await db("normalized_sources").insert({
      id: record.id,
      provider: record.provider,
      version: record.version,
      asset_code: record.assetCode,
      asset_issuer: record.assetIssuer,
      amount: record.amount,
      timestamp: record.timestamp,
      raw: JSON.stringify(record.raw),
    });
    logger.info({ sourceId: record.id }, "Normalized source persisted");
  }
}

/**
 * Example adapter for a fictional "stellar" provider.
 * Real implementations would live in separate files and be imported / registered at boot.
 */
class StellarAdapter implements ProviderAdapter {
  provider = "stellar" as const;
  version = "v1" as const;
  private schemaValidator = new SchemaValidator();
  private validateFn: ReturnType<SchemaValidator["compile"]>;

  constructor() {
    // Very small example schema – real contracts would be richer.
    const schema = {
      type: "object",
      required: ["asset_code", "asset_issuer", "amount", "timestamp"],
      properties: {
        asset_code: { type: "string" },
        asset_issuer: { type: "string" },
        amount: { type: "number" },
        timestamp: { type: "string", format: "date-time" },
        // allow any other fields – they will be captured in `raw`
      },
      additionalProperties: true,
    };
    this.validateFn = this.schemaValidator.compile(schema);
  }

  validate(payload: unknown): boolean {
    return this.validateFn(payload);
  }

  normalize(payload: unknown): NormalizedSource {
    const data = payload as Record<string, unknown>;
    const id = crypto.randomUUID();
    const raw = { ...data };
    // Remove known fields from raw to avoid duplication
    delete raw["asset_code"];
    delete raw["asset_issuer"];
    delete raw["amount"];
    delete raw["timestamp"];

    return {
      id,
      provider: this.provider,
      version: this.version,
      assetCode: String(data["asset_code"]),
      assetIssuer: String(data["asset_issuer"]),
      amount: Number(data["amount"]),
      timestamp: new Date(String(data["timestamp"])),
      raw,
    };
  }
}

// Register example adapter at module load time – real code may register via a bootstrap routine.
adapterRegistry.register(new StellarAdapter());
