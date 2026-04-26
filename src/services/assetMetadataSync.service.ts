import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { assetMetadataService, type AssetMetadata } from "./assetMetadata.service.js";
import { CoinGeckoMetadataSource } from "./sources/coingecko-metadata.source.js";
import { StaticMetadataSource } from "./sources/static-metadata.source.js";
import { StellarExpertMetadataSource } from "./sources/stellar-expert-metadata.source.js";
import type { MetadataSourceAdapter, MetadataSourcePayload } from "./sources/assetMetadataSync.types.js";

export type SyncField =
  | "logo_url"
  | "description"
  | "website_url"
  | "documentation_url"
  | "category"
  | "tags"
  | "social_links"
  | "token_specifications";

export interface SyncOptions {
  symbols?: string[];
  fields?: SyncField[];
  force?: boolean;
  triggeredBy?: string;
}

interface SyncRunResult {
  symbol: string;
  status: "success" | "failed" | "skipped";
  source: string | null;
  conflicts: string[];
  error?: string;
}

const ALL_SYNC_FIELDS: SyncField[] = [
  "logo_url",
  "description",
  "website_url",
  "documentation_url",
  "category",
  "tags",
  "social_links",
  "token_specifications",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

export class AssetMetadataSyncService {
  private readonly adapters: MetadataSourceAdapter[];

  constructor(adapters?: MetadataSourceAdapter[]) {
    this.adapters =
      adapters ?? [
        new StaticMetadataSource(),
        new CoinGeckoMetadataSource(),
        new StellarExpertMetadataSource(),
      ];
  }

  async syncAll(options: SyncOptions = {}): Promise<{ results: SyncRunResult[]; total: number }> {
    const db = getDatabase();
    const assetRows = await db("assets")
      .select("id", "symbol")
      .modify((qb: any) => {
        if (options.symbols && options.symbols.length > 0) {
          qb.whereIn("symbol", options.symbols.map((item) => item.toUpperCase()));
        }
      })
      .orderBy("symbol", "asc");

    const results: SyncRunResult[] = [];

    for (const row of assetRows) {
      const result = await this.syncSingleAsset({
        assetId: row.id,
        symbol: row.symbol,
        fields: options.fields,
        force: options.force,
        triggeredBy: options.triggeredBy,
      });
      results.push(result);
    }

    return { results, total: results.length };
  }

  async syncSingleAsset(input: {
    assetId: string;
    symbol: string;
    fields?: SyncField[];
    force?: boolean;
    triggeredBy?: string;
  }): Promise<SyncRunResult> {
    const db = getDatabase();
    const startedAt = new Date();
    const selectedFields = input.fields && input.fields.length > 0 ? input.fields : ALL_SYNC_FIELDS;
    const symbol = input.symbol.toUpperCase();
    const triggeredBy = input.triggeredBy ?? "system";

    const existing = await assetMetadataService.getMetadata(input.assetId);

    if (existing?.manual_override && !input.force) {
      await this.insertSyncRun({
        assetId: input.assetId,
        symbol,
        status: "skipped",
        source: null,
        selectedFields,
        sourcesAttempted: 0,
        sourcesSucceeded: 0,
        conflicts: [],
        appliedChanges: {},
        triggeredBy,
        startedAt,
        completedAt: new Date(),
      });

      return {
        symbol,
        status: "skipped",
        source: null,
        conflicts: [],
      };
    }

    try {
      const responses: MetadataSourcePayload[] = [];
      const errors: string[] = [];

      for (const adapter of this.adapters) {
        if (!adapter.supports(symbol)) {
          continue;
        }

        try {
          const payload = await adapter.fetch({
            symbol,
            assetId: input.assetId,
            existing,
          });
          if (payload) {
            responses.push(payload);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${adapter.source}: ${message}`);
        }
      }

      if (responses.length === 0) {
        throw new Error(errors[0] ?? "No metadata source returned data");
      }

      const resolved = this.resolveConflicts(existing, responses, selectedFields);

      if (resolved.logo_url) {
        const imageOk = await this.validateImageUrl(resolved.logo_url);
        if (!imageOk) {
          delete resolved.logo_url;
          errors.push("logo_url rejected: URL does not appear to be a valid image");
        }
      }

      const validation = assetMetadataService.validateMetadata(resolved);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join("; ")}`);
      }

      const updated = await assetMetadataService.upsertMetadata(
        input.assetId,
        symbol,
        resolved,
        triggeredBy,
      );

      await db("asset_metadata")
        .where({ asset_id: input.assetId })
        .update({
          last_synced_at: new Date(),
          last_sync_status: "success",
          last_sync_error: errors.length > 0 ? errors.join(" | ") : null,
          image_last_validated_at: new Date(),
          source_priority: JSON.stringify(this.adapters.map((adapter) => adapter.source)),
          updated_at: new Date(),
        });

      await this.insertSyncRun({
        assetId: input.assetId,
        symbol,
        status: "success",
        source: resolved.__source,
        selectedFields,
        sourcesAttempted: this.adapters.filter((adapter) => adapter.supports(symbol)).length,
        sourcesSucceeded: responses.length,
        conflicts: resolved.__conflicts,
        appliedChanges: resolved.__changes,
        triggeredBy,
        startedAt,
        completedAt: new Date(),
      });

      logger.info(
        {
          assetId: input.assetId,
          symbol,
          source: resolved.__source,
          version: updated.version,
          conflicts: resolved.__conflicts,
        },
        "Asset metadata sync completed",
      );

      return {
        symbol,
        status: "success",
        source: resolved.__source,
        conflicts: resolved.__conflicts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await db("asset_metadata")
        .where({ asset_id: input.assetId })
        .update({
          last_sync_status: "failed",
          last_sync_error: message,
          updated_at: new Date(),
        });

      await this.insertSyncRun({
        assetId: input.assetId,
        symbol,
        status: "failed",
        source: null,
        selectedFields,
        sourcesAttempted: this.adapters.filter((adapter) => adapter.supports(symbol)).length,
        sourcesSucceeded: 0,
        conflicts: [],
        appliedChanges: {},
        errorMessage: message,
        triggeredBy,
        startedAt,
        completedAt: new Date(),
      });

      logger.error(
        {
          assetId: input.assetId,
          symbol,
          error: message,
        },
        "ASSET_METADATA_SYNC_FAILURE",
      );

      return {
        symbol,
        status: "failed",
        source: null,
        conflicts: [],
        error: message,
      };
    }
  }

  async setManualOverride(assetId: string, override: boolean, reason: string | null, changedBy: string): Promise<void> {
    await assetMetadataService.setManualOverride(assetId, override, reason, changedBy);
  }

  async getSyncHistory(symbol: string, limit = 50): Promise<unknown[]> {
    const db = getDatabase();
    return db("asset_metadata_sync_runs")
      .where({ symbol: symbol.toUpperCase() })
      .orderBy("started_at", "desc")
      .limit(Math.min(limit, 200));
  }

  private resolveConflicts(
    existing: AssetMetadata | null,
    responses: MetadataSourcePayload[],
    selectedFields: SyncField[],
  ): Partial<AssetMetadata> & {
    __source: string | null;
    __conflicts: string[];
    __changes: Record<string, unknown>;
  } {
    const conflicts: string[] = [];
    const applied: Record<string, unknown> = {};
    const output: Partial<AssetMetadata> = {};

    for (const field of selectedFields) {
      const candidates = responses
        .map((response) => ({ source: response.source, value: response.data[field] }))
        .filter((item) => !isEmptyValue(item.value));

      if (candidates.length === 0) {
        continue;
      }

      const unique = new Set(candidates.map((item) => JSON.stringify(item.value)));
      if (unique.size > 1) {
        conflicts.push(field);
      }

      const chosen = candidates[0];
      (output as Record<string, unknown>)[field] = chosen.value;

      const previousValue = existing
        ? (existing as unknown as Record<string, unknown>)[field]
        : undefined;
      if (JSON.stringify(previousValue) !== JSON.stringify(chosen.value)) {
        applied[field] = {
          from: previousValue ?? null,
          to: chosen.value,
          source: chosen.source,
        };
      }
    }

    return {
      ...output,
      __source: responses[0]?.source ?? null,
      __conflicts: conflicts,
      __changes: applied,
    };
  }

  private async validateImageUrl(url: string): Promise<boolean> {
    if (!url) return false;

    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return false;
      }

      const response = await fetch(url, {
        method: "HEAD",
        headers: { Accept: "image/*" },
      });

      const contentType = response.headers.get("content-type") ?? "";
      return response.ok && contentType.startsWith("image/");
    } catch {
      return false;
    }
  }

  private async insertSyncRun(input: {
    assetId: string;
    symbol: string;
    status: "success" | "failed" | "skipped";
    source: string | null;
    selectedFields: SyncField[];
    sourcesAttempted: number;
    sourcesSucceeded: number;
    conflicts: string[];
    appliedChanges: Record<string, unknown>;
    errorMessage?: string;
    triggeredBy: string;
    startedAt: Date;
    completedAt: Date;
  }): Promise<void> {
    const db = getDatabase();

    await db("asset_metadata_sync_runs").insert({
      asset_id: input.assetId,
      symbol: input.symbol,
      status: input.status,
      source: input.source,
      selective_refresh: input.selectedFields.length < ALL_SYNC_FIELDS.length,
      selected_fields: JSON.stringify(input.selectedFields),
      sources_attempted: input.sourcesAttempted,
      sources_succeeded: input.sourcesSucceeded,
      conflict_resolved: input.conflicts.length > 0,
      conflicts: JSON.stringify(input.conflicts),
      applied_changes: JSON.stringify(input.appliedChanges),
      error_message: input.errorMessage ?? null,
      triggered_by: input.triggeredBy,
      started_at: input.startedAt,
      completed_at: input.completedAt,
    });
  }
}

export const assetMetadataSyncService = new AssetMetadataSyncService();
