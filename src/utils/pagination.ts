export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface PaginationQuery {
  page?: number;
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface PaginationLinks {
  self: string;
  first: string;
  prev: string | null;
  next: string | null;
  last: string | null;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  nextCursor?: string;
  prevCursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
  links?: PaginationLinks;
}

export function getPaginationParams(query: PaginationQuery): {
  limit: number;
  offset: number;
  page: number;
} {
  const page = Math.max(1, query.page || 1);
  const limit = Math.max(1, Math.min(MAX_PAGE_LIMIT, query.limit || DEFAULT_PAGE_LIMIT));
  const offset = query.offset !== undefined ? query.offset : (page - 1) * limit;

  return { limit, offset, page };
}

export function formatPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  baseUrl?: string,
  extraParams?: Record<string, string>
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;
  const meta: PaginationMeta = {
    total,
    page,
    limit,
    totalPages,
    hasNext,
    hasPrev,
  };

  if (!baseUrl) {
    return { data, meta };
  }

  const buildUrl = (p: number) => {
    const url = new URL(baseUrl);
    url.searchParams.set("page", String(p));
    url.searchParams.set("limit", String(limit));
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  };

  const links: PaginationLinks = {
    self: buildUrl(page),
    first: buildUrl(1),
    prev: hasPrev ? buildUrl(page - 1) : null,
    next: hasNext ? buildUrl(page + 1) : null,
    last: totalPages > 0 ? buildUrl(totalPages) : null,
  };

  return { data, meta, links };
}

export function encodeCursor(value: string | number): string {
  return Buffer.from(String(value)).toString("base64url");
}

export function decodeCursor(cursor: string): string {
  try {
    return Buffer.from(cursor, "base64url").toString("utf-8");
  } catch {
    return "";
  }
}

export function buildLinkHeader(links: PaginationLinks): string {
  const parts: string[] = [];
  if (links.first) parts.push(`<${links.first}>; rel="first"`);
  if (links.prev) parts.push(`<${links.prev}>; rel="prev"`);
  if (links.next) parts.push(`<${links.next}>; rel="next"`);
  if (links.last) parts.push(`<${links.last}>; rel="last"`);
  return parts.join(", ");
}

export function validatePaginationParams(page: number, limit: number): string | null {
  if (!Number.isInteger(page) || page < 1) {
    return "page must be a positive integer";
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    return `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`;
  }
  return null;
}
