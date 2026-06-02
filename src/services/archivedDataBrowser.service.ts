import type { Knex } from "knex";
import { getDatabase } from "../database/connection.js";

/**
 * Read-only browser for archived historical snapshots stored in `*_archive`
 * tables. Operators can inspect old data without restoring it to live tables.
 */

export interface RawArchiveBrowserQuery {
  entityType?: string;
  /** Asset symbol or pool id depending on entity type. */
  asset?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number | string;
  pageSize?: number | string;
}

export interface ArchiveBrowserQuery {
  entityType: string;
  asset?: string;
  from?: Date;
  to?: Date;
  text?: string;
  page: number;
  pageSize: number;
}

export interface ArchiveBrowserPage {
  entityType: string;
  tableName: string;
  results: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ArchiveEntityInfo {
  entityType: string;
  tableName: string;
  archiveTableName: string;
  assetColumn: string | null;
  timeColumn: string;
}

export const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;

/** Supported archive entity types and their filter columns. */
export const ARCHIVE_ENTITIES: Record<string, ArchiveEntityInfo> = {
  prices: {
    entityType: "prices",
    tableName: "prices",
    archiveTableName: "prices_archive",
    assetColumn: "symbol",
    timeColumn: "time",
  },
  health_scores: {
    entityType: "health_scores",
    tableName: "health_scores",
    archiveTableName: "health_scores_archive",
    assetColumn: "symbol",
    timeColumn: "time",
  },
  pool_events: {
    entityType: "pool_events",
    tableName: "pool_events",
    archiveTableName: "pool_events_archive",
    assetColumn: "pool_id",
    timeColumn: "time",
  },
  pool_metrics: {
    entityType: "pool_metrics",
    tableName: "pool_metrics",
    archiveTableName: "pool_metrics_archive",
    assetColumn: "pool_id",
    timeColumn: "time",
  },
};

function toPositiveInt(label: string, value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`archiveBrowser: ${label} must be a positive integer, got "${value}"`);
  }
  return n;
}

function parseDate(label: string, value: string | undefined): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`archiveBrowser: ${label} is not a valid date: "${value}"`);
  }
  return date;
}

/** Validate and normalise raw query parameters. */
export function normalizeArchiveBrowserQuery(raw: RawArchiveBrowserQuery): ArchiveBrowserQuery {
  const entityType = raw.entityType?.trim();
  if (!entityType) {
    throw new Error("archiveBrowser: entityType is required");
  }
  if (!ARCHIVE_ENTITIES[entityType]) {
    throw new Error(
      `archiveBrowser: unsupported entityType "${entityType}". Supported: ${Object.keys(ARCHIVE_ENTITIES).join(", ")}`,
    );
  }

  const from = parseDate("from", raw.from);
  const to = parseDate("to", raw.to);
  if (from && to && from > to) {
    throw new Error("archiveBrowser: 'from' must be before or equal to 'to'");
  }

  const text = raw.q?.trim();
  const asset = raw.asset?.trim();

  return {
    entityType,
    asset: asset && asset.length > 0 ? asset : undefined,
    from,
    to,
    text: text && text.length > 0 ? text : undefined,
    page: toPositiveInt("page", raw.page, 1),
    pageSize: Math.min(
      toPositiveInt("pageSize", raw.pageSize, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    ),
  };
}

export class ArchivedDataBrowserService {
  private readonly db: Knex = getDatabase();

  listEntities(): ArchiveEntityInfo[] {
    return Object.values(ARCHIVE_ENTITIES);
  }

  private async tableExists(tableName: string): Promise<boolean> {
    return this.db.schema.hasTable(tableName);
  }

  private applyFilters(
    qb: Knex.QueryBuilder,
    entity: ArchiveEntityInfo,
    q: ArchiveBrowserQuery,
  ): Knex.QueryBuilder {
    if (q.from) {
      qb.where(entity.timeColumn, ">=", q.from);
    }
    if (q.to) {
      qb.where(entity.timeColumn, "<=", q.to);
    }
    if (q.asset && entity.assetColumn) {
      qb.where(entity.assetColumn, q.asset);
    }
    if (q.text && entity.assetColumn) {
      qb.where(entity.assetColumn, "ilike", `%${q.text}%`);
    }
    return qb;
  }

  async search(raw: RawArchiveBrowserQuery): Promise<ArchiveBrowserPage> {
    const q = normalizeArchiveBrowserQuery(raw);
    const entity = ARCHIVE_ENTITIES[q.entityType]!;

    const exists = await this.tableExists(entity.archiveTableName);
    if (!exists) {
      return {
        entityType: q.entityType,
        tableName: entity.archiveTableName,
        results: [],
        total: 0,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: 0,
      };
    }

    const base = this.db(entity.archiveTableName);
    const countRow = await this.applyFilters(base.clone(), entity, q).count("* as count").first();
    const total = Number(countRow?.count ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / q.pageSize);
    const offset = (q.page - 1) * q.pageSize;

    const results = await this.applyFilters(base.clone(), entity, q)
      .orderBy(entity.timeColumn, "desc")
      .limit(q.pageSize)
      .offset(offset);

    return {
      entityType: q.entityType,
      tableName: entity.archiveTableName,
      results,
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages,
    };
  }

  async getSnapshot(entityType: string, id: string | number): Promise<Record<string, unknown> | null> {
    const entity = ARCHIVE_ENTITIES[entityType];
    if (!entity) {
      throw new Error(`archiveBrowser: unsupported entityType "${entityType}"`);
    }
    if (!(await this.tableExists(entity.archiveTableName))) {
      return null;
    }
    return (
      (await this.db(entity.archiveTableName).where({ id }).first()) ?? null
    );
  }
}
