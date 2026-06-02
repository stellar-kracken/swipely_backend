import type { Knex } from "knex";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { redis } from "../utils/redis.js";

export interface QueryPreset {
  id: string;
  name: string;
  description?: string;
  category: string;
  query_definition: Record<string, unknown>;
  is_shared: boolean;
  created_by: string;
  version: string;
  access_rules: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  last_used_at?: Date;
}

export interface QueryPresetVersion {
  id: string;
  preset_id: string;
  version: string;
  query_definition: Record<string, unknown>;
  change_notes?: string;
  created_by: string;
  created_at: Date;
}

export interface CreateQueryPresetInput {
  name: string;
  description?: string;
  category: string;
  query_definition: Record<string, unknown>;
  is_shared?: boolean;
  created_by: string;
  access_rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateQueryPresetInput {
  name?: string;
  description?: string;
  category?: string;
  query_definition?: Record<string, unknown>;
  is_shared?: boolean;
  access_rules?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  change_notes?: string;
  updated_by: string;
}

const CACHE_TTL = 3600; // 1 hour
const CACHE_KEY_PREFIX = "query_preset:";

export class QueryPresetService {
  private db: Knex;

  constructor() {
    this.db = getDatabase();
  }

  private getCacheKey(id: string): string {
    return `${CACHE_KEY_PREFIX}${id}`;
  }

  private async invalidateCache(id: string): Promise<void> {
    try {
      await redis.del(this.getCacheKey(id));
      await redis.del(`${CACHE_KEY_PREFIX}list:*`);
    } catch (error) {
      logger.warn(
        { error, presetId: id },
        "Failed to invalidate query preset cache",
      );
    }
  }

  async createPreset(input: CreateQueryPresetInput): Promise<QueryPreset> {
    const [preset] = await this.db("query_presets")
      .insert({
        name: input.name,
        description: input.description,
        category: input.category,
        query_definition: JSON.stringify(input.query_definition),
        is_shared: input.is_shared ?? false,
        created_by: input.created_by,
        version: "1.0.0",
        access_rules: JSON.stringify(input.access_rules ?? {}),
        metadata: JSON.stringify(input.metadata ?? {}),
      })
      .returning("*");

    // Create initial version
    await this.db("query_preset_versions").insert({
      preset_id: preset.id,
      version: "1.0.0",
      query_definition: JSON.stringify(input.query_definition),
      change_notes: "Initial version",
      created_by: input.created_by,
    });

    logger.info(
      { presetId: preset.id, name: input.name },
      "Query preset created",
    );

    return this.parsePreset(preset);
  }

  async getPresetById(id: string, userId: string): Promise<QueryPreset | null> {
    const cacheKey = this.getCacheKey(id);

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.warn({ error, presetId: id }, "Cache read failed");
    }

    const preset = await this.db("query_presets").where({ id }).first();

    if (!preset) {
      return null;
    }

    // Check access rules
    if (!this.hasAccess(preset, userId)) {
      return null;
    }

    const parsed = this.parsePreset(preset);

    try {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(parsed));
    } catch (error) {
      logger.warn({ error }, "Cache write failed");
    }

    return parsed;
  }

  async listPresets(
    userId: string,
    filters?: {
      category?: string;
      is_shared?: boolean;
      search?: string;
    },
  ): Promise<QueryPreset[]> {
    let query = this.db("query_presets").where((builder) => {
      builder.where({ created_by: userId }).orWhere({ is_shared: true });
    });

    if (filters?.category) {
      query = query.where({ category: filters.category });
    }

    if (filters?.is_shared !== undefined) {
      query = query.where({ is_shared: filters.is_shared });
    }

    if (filters?.search) {
      query = query.where((builder) => {
        builder
          .where("name", "ilike", `%${filters.search}%`)
          .orWhere("description", "ilike", `%${filters.search}%`);
      });
    }

    const presets = await query.orderBy("updated_at", "desc");

    return presets.map((p) => this.parsePreset(p));
  }

  async updatePreset(
    id: string,
    userId: string,
    input: UpdateQueryPresetInput,
  ): Promise<QueryPreset | null> {
    const existing = await this.db("query_presets").where({ id }).first();

    if (!existing || !this.canModify(existing, userId)) {
      return null;
    }

    const updateData: Record<string, unknown> = {
      updated_at: this.db.fn.now(),
    };

    if (input.name) updateData.name = input.name;
    if (input.description !== undefined)
      updateData.description = input.description;
    if (input.category) updateData.category = input.category;
    if (input.is_shared !== undefined) updateData.is_shared = input.is_shared;
    if (input.access_rules)
      updateData.access_rules = JSON.stringify(input.access_rules);
    if (input.metadata) updateData.metadata = JSON.stringify(input.metadata);

    // If query definition changed, create new version
    if (input.query_definition) {
      const newVersion = this.incrementVersion(existing.version);
      updateData.query_definition = JSON.stringify(input.query_definition);
      updateData.version = newVersion;

      await this.db("query_preset_versions").insert({
        preset_id: id,
        version: newVersion,
        query_definition: JSON.stringify(input.query_definition),
        change_notes: input.change_notes,
        created_by: input.updated_by,
      });
    }

    const [updated] = await this.db("query_presets")
      .where({ id })
      .update(updateData)
      .returning("*");

    await this.invalidateCache(id);

    logger.info({ presetId: id }, "Query preset updated");

    return this.parsePreset(updated);
  }

  async deletePreset(id: string, userId: string): Promise<boolean> {
    const preset = await this.db("query_presets").where({ id }).first();

    if (!preset || !this.canModify(preset, userId)) {
      return false;
    }

    await this.db("query_presets").where({ id }).delete();
    await this.invalidateCache(id);

    logger.info({ presetId: id }, "Query preset deleted");

    return true;
  }

  async getPresetVersions(
    presetId: string,
    userId: string,
  ): Promise<QueryPresetVersion[]> {
    const preset = await this.db("query_presets")
      .where({ id: presetId })
      .first();

    if (!preset || !this.hasAccess(preset, userId)) {
      return [];
    }

    const versions = await this.db("query_preset_versions")
      .where({ preset_id: presetId })
      .orderBy("created_at", "desc");

    return versions.map((v) => ({
      ...v,
      query_definition: JSON.parse(v.query_definition),
    }));
  }

  async recordUsage(id: string): Promise<void> {
    await this.db("query_presets")
      .where({ id })
      .update({ last_used_at: this.db.fn.now() });
  }

  async validateQueryDefinition(
    definition: Record<string, unknown>,
  ): Promise<boolean> {
    // Basic validation - can be extended based on requirements
    if (!definition || typeof definition !== "object") {
      return false;
    }

    // Check for required fields based on category
    const requiredFields = ["filters", "fields"];
    return requiredFields.every((field) => field in definition);
  }

  private parsePreset(row: any): QueryPreset {
    return {
      ...row,
      query_definition: JSON.parse(row.query_definition),
      access_rules: JSON.parse(row.access_rules),
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  }

  private hasAccess(preset: any, userId: string): boolean {
    if (preset.created_by === userId) {
      return true;
    }

    if (preset.is_shared) {
      return true;
    }

    // Check access rules
    const accessRules = JSON.parse(preset.access_rules || "{}");
    return accessRules.allowedUsers?.includes(userId) ?? false;
  }

  private canModify(preset: any, userId: string): boolean {
    return preset.created_by === userId;
  }

  private incrementVersion(currentVersion: string): string {
    const parts = currentVersion.split(".").map(Number);
    parts[2] = (parts[2] || 0) + 1;
    return parts.join(".");
  }
}

export const queryPresetService = new QueryPresetService();
