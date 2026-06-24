import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import type { CustomMetric } from "./analytics.service.js";
import { AnalyticsService } from "./analytics.service.js";

const BLOCKED_SQL_PATTERN =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|attach|detach|pragma)\b/i;

export interface SavedMetric {
  id: string;
  name: string;
  description: string | null;
  formula: string;
  isShared: boolean;
  createdBy: string;
  cacheTtl: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedMetricInput {
  name: string;
  description?: string;
  formula: string;
  isShared?: boolean;
  createdBy: string;
  cacheTtl?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateSavedMetricInput {
  name?: string;
  description?: string;
  formula?: string;
  isShared?: boolean;
  cacheTtl?: number;
  metadata?: Record<string, unknown>;
}

export interface MetricValidationResult {
  valid: boolean;
  errors: string[];
  preview?: {
    rowCount: number;
    columns: string[];
    sampleRows: Record<string, unknown>[];
  };
}

export class SavedMetricService {
  private db = getDatabase();
  private analytics = new AnalyticsService();

  validateFormula(formula: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const trimmed = formula.trim();

    if (!trimmed) {
      errors.push("Formula cannot be empty");
      return { valid: false, errors };
    }

    if (!/^\s*select\b/i.test(trimmed)) {
      errors.push("Formula must be a SELECT query");
    }

    if (trimmed.includes(";")) {
      errors.push("Multiple statements are not allowed");
    }

    if (BLOCKED_SQL_PATTERN.test(trimmed)) {
      errors.push("Only read-only SELECT queries are permitted");
    }

    return { valid: errors.length === 0, errors };
  }

  async previewFormula(formula: string): Promise<MetricValidationResult> {
    const validation = this.validateFormula(formula);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors };
    }

    try {
      const limitedQuery = `SELECT * FROM (${formula.replace(/;\s*$/, "")}) AS preview_query LIMIT 5`;
      const result = await this.db.raw(limitedQuery);
      const rows = (result.rows ?? result) as Record<string, unknown>[];
      const columns = rows[0] ? Object.keys(rows[0]) : [];

      return {
        valid: true,
        errors: [],
        preview: {
          rowCount: rows.length,
          columns,
          sampleRows: rows,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Query execution failed";
      return { valid: false, errors: [message] };
    }
  }

  async listMetrics(userId: string): Promise<SavedMetric[]> {
    const rows = await this.db("user_saved_metrics")
      .where("created_by", userId)
      .orWhere("is_shared", true)
      .orderBy("updated_at", "desc");

    return rows.map(this.mapRow);
  }

  async getMetric(id: string, userId: string): Promise<SavedMetric | null> {
    const row = await this.db("user_saved_metrics")
      .where("id", id)
      .andWhere((qb) => {
        qb.where("created_by", userId).orWhere("is_shared", true);
      })
      .first();

    return row ? this.mapRow(row) : null;
  }

  async createMetric(input: CreateSavedMetricInput): Promise<SavedMetric> {
    const validation = this.validateFormula(input.formula);
    if (!validation.valid) {
      throw new Error(validation.errors.join("; "));
    }

    const [row] = await this.db("user_saved_metrics")
      .insert({
        name: input.name.trim(),
        description: input.description?.trim() ?? null,
        formula: input.formula.trim(),
        is_shared: input.isShared ?? false,
        created_by: input.createdBy,
        cache_ttl: input.cacheTtl ?? 600,
        metadata: JSON.stringify(input.metadata ?? {}),
      })
      .returning("*");

    logger.info({ metricId: row.id, name: input.name }, "Saved custom metric created");
    return this.mapRow(row);
  }

  async updateMetric(
    id: string,
    userId: string,
    input: UpdateSavedMetricInput,
  ): Promise<SavedMetric | null> {
    const existing = await this.db("user_saved_metrics")
      .where({ id, created_by: userId })
      .first();

    if (!existing) return null;

    if (input.formula) {
      const validation = this.validateFormula(input.formula);
      if (!validation.valid) {
        throw new Error(validation.errors.join("; "));
      }
    }

    const [row] = await this.db("user_saved_metrics")
      .where({ id, created_by: userId })
      .update({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.formula !== undefined ? { formula: input.formula.trim() } : {}),
        ...(input.isShared !== undefined ? { is_shared: input.isShared } : {}),
        ...(input.cacheTtl !== undefined ? { cache_ttl: input.cacheTtl } : {}),
        ...(input.metadata !== undefined ? { metadata: JSON.stringify(input.metadata) } : {}),
        updated_at: new Date(),
      })
      .returning("*");

    return row ? this.mapRow(row) : null;
  }

  async deleteMetric(id: string, userId: string): Promise<boolean> {
    const count = await this.db("user_saved_metrics")
      .where({ id, created_by: userId })
      .delete();
    return count > 0;
  }

  async executeSavedMetric(id: string, userId: string, forceRefresh = false) {
    const saved = await this.getMetric(id, userId);
    if (!saved) return null;

    const metric: CustomMetric = {
      id: saved.id,
      name: saved.name,
      description: saved.description ?? "",
      query: saved.formula,
      parameters: {},
      cacheKey: `saved-${saved.id}`,
      cacheTTL: saved.cacheTtl,
    };

    const result = await this.analytics.executeCustomMetric(metric, forceRefresh);
    return { metric: saved, result };
  }

  private mapRow(row: Record<string, unknown>): SavedMetric {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      formula: row.formula as string,
      isShared: Boolean(row.is_shared),
      createdBy: row.created_by as string,
      cacheTtl: Number(row.cache_ttl ?? 600),
      metadata:
        typeof row.metadata === "object" && row.metadata !== null
          ? (row.metadata as Record<string, unknown>)
          : JSON.parse((row.metadata as string) || "{}"),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
    };
  }
}

export const savedMetricService = new SavedMetricService();
