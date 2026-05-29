import type { Knex } from "knex";
import { getDatabase } from "../database/connection.js";

/**
 * Search and filtering over historical alert events (`alert_events`) so
 * operators can investigate prior incidents: time-range, severity, source and
 * alert-type filters, full-text matching, pagination and CSV export.
 *
 * Query normalisation and CSV serialisation are pure exported helpers so they
 * can be unit-tested without a database.
 */

export interface RawAlertHistoryQuery {
  from?: string;
  to?: string;
  /** Severity == alert priority. Accepts a single value or comma list/array. */
  severity?: string | string[];
  /** Source == asset code. Accepts a single value or comma list/array. */
  source?: string | string[];
  alertType?: string | string[];
  /** Full-text term matched against alert_type / metric / asset_code. */
  q?: string;
  page?: number | string;
  pageSize?: number | string;
}

export interface AlertHistoryQuery {
  from?: Date;
  to?: Date;
  severities: string[];
  sources: string[];
  alertTypes: string[];
  text?: string;
  page: number;
  pageSize: number;
}

export interface AlertHistoryPage {
  results: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;
const EXPORT_CAP = 10_000;

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : value.split(",");
  return raw.map((v) => v.trim()).filter((v) => v.length > 0);
}

function parseDate(label: string, value: string | undefined): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`alertHistory: ${label} is not a valid date: "${value}"`);
  }
  return date;
}

function toPositiveInt(label: string, value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`alertHistory: ${label} must be a positive integer, got "${value}"`);
  }
  return n;
}

/** Validate + normalise raw request query into a typed, defaulted query. */
export function normalizeAlertHistoryQuery(raw: RawAlertHistoryQuery): AlertHistoryQuery {
  const from = parseDate("from", raw.from);
  const to = parseDate("to", raw.to);
  if (from && to && from > to) {
    throw new Error("alertHistory: 'from' must be before or equal to 'to'");
  }
  const text = raw.q?.trim();
  return {
    from,
    to,
    severities: toArray(raw.severity),
    sources: toArray(raw.source),
    alertTypes: toArray(raw.alertType),
    text: text && text.length > 0 ? text : undefined,
    page: toPositiveInt("page", raw.page, 1),
    pageSize: Math.min(toPositiveInt("pageSize", raw.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE),
  };
}

const CSV_COLUMNS = [
  "time",
  "rule_id",
  "asset_code",
  "alert_type",
  "priority",
  "metric",
  "triggered_value",
  "threshold",
] as const;

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialise alert event rows to CSV with a stable column order and escaping. */
export function alertEventsToCsv(rows: Record<string, unknown>[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
  return [header, ...lines].join("\n");
}

export class AlertHistorySearchService {
  private readonly db: Knex = getDatabase();

  private applyFilters(qb: Knex.QueryBuilder, q: AlertHistoryQuery): Knex.QueryBuilder {
    if (q.from) qb.where("time", ">=", q.from);
    if (q.to) qb.where("time", "<=", q.to);
    if (q.severities.length) qb.whereIn("priority", q.severities);
    if (q.sources.length) qb.whereIn("asset_code", q.sources);
    if (q.alertTypes.length) qb.whereIn("alert_type", q.alertTypes);
    if (q.text) {
      const like = `%${q.text}%`;
      qb.where((b) =>
        b
          .whereILike("alert_type", like)
          .orWhereILike("metric", like)
          .orWhereILike("asset_code", like),
      );
    }
    return qb;
  }

  /** Paginated search over alert history, newest first. */
  async search(raw: RawAlertHistoryQuery): Promise<AlertHistoryPage> {
    const q = normalizeAlertHistoryQuery(raw);

    const countRow = await this.applyFilters(this.db("alert_events"), q).count<{ count: string }[]>(
      "* as count",
    );
    const total = Number(countRow[0]?.count ?? 0);

    const results = await this.applyFilters(this.db("alert_events"), q)
      .orderBy("time", "desc")
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);

    return {
      results,
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / q.pageSize),
    };
  }

  /** Export matching alert history as CSV (capped to avoid unbounded exports). */
  async exportCsv(raw: RawAlertHistoryQuery): Promise<string> {
    const q = normalizeAlertHistoryQuery(raw);
    const rows = await this.applyFilters(this.db("alert_events"), q)
      .orderBy("time", "desc")
      .limit(EXPORT_CAP);
    return alertEventsToCsv(rows as Record<string, unknown>[]);
  }
}
