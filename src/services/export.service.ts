/**
 * Data Export Service
 * Handles data export in various formats (CSV, JSON, Excel) with async processing
 */

import { getDatabase } from "../database/connection";
import { logger } from "../utils/logger";
import { randomBytes } from "crypto";
import { redis } from "../utils/redis";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "json" | "excel";
export type ExportStatus = "pending" | "processing" | "completed" | "failed";

export interface ExportRequest {
  id: string;
  user_id: string;
  export_type: string;
  format: ExportFormat;
  filters: ExportFilters;
  fields: string[];
  status: ExportStatus;
  download_url: string | null;
  file_size: number | null;
  row_count: number | null;
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
}

export interface ExportFilters {
  startDate?: string;
  endDate?: string;
  symbols?: string[];
  categories?: string[];
  minValue?: number;
  maxValue?: number;
}

export interface ExportTemplate {
  id: string;
  name: string;
  description: string;
  export_type: string;
  default_format: ExportFormat;
  default_fields: string[];
  default_filters: ExportFilters;
  created_by: string;
  created_at: Date;
}

// ─── Export Service ──────────────────────────────────────────────────────────

export class ExportService {
  private readonly EXPORT_EXPIRY_HOURS = 24;
  private readonly MAX_SYNC_ROWS = 1000;

  /**
   * Create export request
   */
  async createExport(
    userId: string,
    exportType: string,
    format: ExportFormat,
    filters: ExportFilters,
    fields: string[],
  ): Promise<ExportRequest> {
    const db = getDatabase();

    try {
      const exportId = randomBytes(16).toString("hex");
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + this.EXPORT_EXPIRY_HOURS);

      const exportRequest: Partial<ExportRequest> = {
        id: exportId,
        user_id: userId,
        export_type: exportType,
        format,
        filters: JSON.stringify(filters) as any,
        fields: JSON.stringify(fields) as any,
        status: "pending",
        download_url: null,
        file_size: null,
        row_count: null,
        error_message: null,
        created_at: new Date(),
        completed_at: null,
        expires_at: expiresAt,
      };

      await db("export_requests").insert(exportRequest);

      // Check if we should process sync or async
      const estimatedRows = await this.estimateRowCount(exportType, filters);

      if (estimatedRows <= this.MAX_SYNC_ROWS) {
        // Process synchronously
        await this.processExport(exportId);
      } else {
        // Queue for async processing
        await this.queueExport(exportId);
      }

      return (await this.getExport(exportId))!;
    } catch (error) {
      logger.error({ error, userId, exportType }, "Failed to create export");
      throw error;
    }
  }

  /**
   * Get export request
   */
  async getExport(exportId: string): Promise<ExportRequest | null> {
    const db = getDatabase();

    try {
      const exportRequest = await db("export_requests")
        .where({ id: exportId })
        .first();

      if (!exportRequest) {
        return null;
      }

      return {
        ...exportRequest,
        filters: JSON.parse(exportRequest.filters || "{}"),
        fields: JSON.parse(exportRequest.fields || "[]"),
      };
    } catch (error) {
      logger.error({ error, exportId }, "Failed to get export");
      return null;
    }
  }

  /**
   * Process export
   */
  async processExport(exportId: string): Promise<void> {
    const db = getDatabase();

    try {
      const exportRequest = await this.getExport(exportId);
      if (!exportRequest) {
        throw new Error("Export request not found");
      }

      // Update status to processing
      await db("export_requests")
        .where({ id: exportId })
        .update({ status: "processing" });

      // Fetch data
      const data = await this.fetchData(
        exportRequest.export_type,
        exportRequest.filters,
        exportRequest.fields,
      );

      // Convert to requested format
      const fileContent = await this.convertToFormat(
        data,
        exportRequest.format,
        exportRequest.fields,
      );

      // Generate download URL (in production, upload to S3/storage)
      const downloadUrl = await this.generateDownloadUrl(exportId, fileContent);

      // Update export request
      await db("export_requests")
        .where({ id: exportId })
        .update({
          status: "completed",
          download_url: downloadUrl,
          file_size: Buffer.byteLength(fileContent),
          row_count: data.length,
          completed_at: new Date(),
        });

      logger.info({ exportId, rowCount: data.length }, "Export completed");
    } catch (error) {
      logger.error({ error, exportId }, "Failed to process export");

      await db("export_requests")
        .where({ id: exportId })
        .update({
          status: "failed",
          error_message:
            error instanceof Error ? error.message : "Unknown error",
        });
    }
  }

  /**
   * Fetch data based on export type
   */
  private async fetchData(
    exportType: string,
    filters: ExportFilters,
    fields: string[],
  ): Promise<any[]> {
    const db = getDatabase();

    try {
      let query = db(exportType);

      // Apply date filters
      if (filters.startDate) {
        query = query.where("time", ">=", filters.startDate);
      }
      if (filters.endDate) {
        query = query.where("time", "<=", filters.endDate);
      }

      // Apply symbol filters
      if (filters.symbols && filters.symbols.length > 0) {
        query = query.whereIn("symbol", filters.symbols);
      }

      // Apply value filters
      if (filters.minValue !== undefined) {
        query = query.where("value", ">=", filters.minValue);
      }
      if (filters.maxValue !== undefined) {
        query = query.where("value", "<=", filters.maxValue);
      }

      // Select fields
      if (fields.length > 0) {
        query = query.select(fields);
      }

      // Limit for safety
      query = query.limit(100000);

      return await query;
    } catch (error) {
      logger.error({ error, exportType }, "Failed to fetch data");
      throw error;
    }
  }

  /**
   * Convert data to requested format
   */
  private async convertToFormat(
    data: any[],
    format: ExportFormat,
    fields: string[],
  ): Promise<string> {
    switch (format) {
      case "csv":
        return this.convertToCSV(data, fields);
      case "json":
        return this.convertToJSON(data);
      case "excel":
        return this.convertToExcel(data, fields);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Convert to CSV
   */
  private convertToCSV(data: any[], fields: string[]): string {
    if (data.length === 0) {
      return "";
    }

    const headers = fields.length > 0 ? fields : Object.keys(data[0]);
    const rows = data.map((row) =>
      headers
        .map((field) => {
          const value = row[field];
          // Escape quotes and wrap in quotes if contains comma
          if (value === null || value === undefined) return "";
          const stringValue = String(value);
          if (stringValue.includes(",") || stringValue.includes('"')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        })
        .join(","),
    );

    return [headers.join(","), ...rows].join("\n");
  }

  /**
   * Convert to JSON
   */
  private convertToJSON(data: any[]): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * Convert to Excel (simplified - returns CSV for now)
   */
  private convertToExcel(data: any[], fields: string[]): string {
    // In production, use a library like exceljs
    return this.convertToCSV(data, fields);
  }

  /**
   * Generate download URL
   */
  private async generateDownloadUrl(
    exportId: string,
    content: string,
  ): Promise<string> {
    // Store in Redis with expiry
    const key = `export:${exportId}`;
    await redis.setex(key, this.EXPORT_EXPIRY_HOURS * 3600, content);

    // Return download URL
    return `/api/v1/export/download/${exportId}`;
  }

  /**
   * Get download content
   */
  async getDownloadContent(exportId: string): Promise<string | null> {
    try {
      const key = `export:${exportId}`;
      return await redis.get(key);
    } catch (error) {
      logger.error({ error, exportId }, "Failed to get download content");
      return null;
    }
  }

  /**
   * Estimate row count
   */
  private async estimateRowCount(
    exportType: string,
    filters: ExportFilters,
  ): Promise<number> {
    const db = getDatabase();

    try {
      let query = db(exportType);

      if (filters.startDate) {
        query = query.where("time", ">=", filters.startDate);
      }
      if (filters.endDate) {
        query = query.where("time", "<=", filters.endDate);
      }
      if (filters.symbols && filters.symbols.length > 0) {
        query = query.whereIn("symbol", filters.symbols);
      }

      const result = await query.count("* as count").first();
      return parseInt(result?.count as string) || 0;
    } catch (error) {
      logger.error({ error }, "Failed to estimate row count");
      return 0;
    }
  }

  /**
   * Queue export for async processing
   */
  private async queueExport(exportId: string): Promise<void> {
    // In production, use a job queue like Bull
    logger.info({ exportId }, "Export queued for async processing");

    // For now, process in background
    setTimeout(() => this.processExport(exportId), 1000);
  }

  /**
   * Get user export history
   */
  async getExportHistory(
    userId: string,
    limit: number = 50,
  ): Promise<ExportRequest[]> {
    const db = getDatabase();

    try {
      const exports = await db("export_requests")
        .where({ user_id: userId })
        .orderBy("created_at", "desc")
        .limit(limit);

      return exports.map((exp: any) => ({
        ...exp,
        filters: JSON.parse(exp.filters || "{}"),
        fields: JSON.parse(exp.fields || "[]"),
      }));
    } catch (error) {
      logger.error({ error, userId }, "Failed to get export history");
      return [];
    }
  }

  /**
   * Create export template
   */
  async createTemplate(
    template: Omit<ExportTemplate, "id" | "created_at">,
  ): Promise<ExportTemplate> {
    const db = getDatabase();

    try {
      const templateId = randomBytes(16).toString("hex");
      const newTemplate = {
        id: templateId,
        ...template,
        default_fields: JSON.stringify(template.default_fields),
        default_filters: JSON.stringify(template.default_filters),
        created_at: new Date(),
      };

      await db("export_templates").insert(newTemplate);

      return {
        ...newTemplate,
        default_fields: template.default_fields,
        default_filters: template.default_filters,
      } as ExportTemplate;
    } catch (error) {
      logger.error({ error }, "Failed to create template");
      throw error;
    }
  }

  /**
   * Get export templates
   */
  async getTemplates(): Promise<ExportTemplate[]> {
    const db = getDatabase();

    try {
      const templates = await db("export_templates").orderBy("name");

      return templates.map((t: any) => ({
        ...t,
        default_fields: JSON.parse(t.default_fields || "[]"),
        default_filters: JSON.parse(t.default_filters || "{}"),
      }));
    } catch (error) {
      logger.error({ error }, "Failed to get templates");
      return [];
    }
  }

  /**
   * Cleanup expired exports
   */
  async cleanupExpiredExports(): Promise<void> {
    const db = getDatabase();

    try {
      const expired = await db("export_requests")
        .where("expires_at", "<", new Date())
        .where("status", "completed");

      for (const exp of expired) {
        // Delete from Redis
        await redis.del(`export:${exp.id}`);
      }

      // Delete from database
      await db("export_requests").where("expires_at", "<", new Date()).delete();

      logger.info({ count: expired.length }, "Cleaned up expired exports");
    } catch (error) {
      logger.error({ error }, "Failed to cleanup expired exports");
    }
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const exportService = new ExportService();
