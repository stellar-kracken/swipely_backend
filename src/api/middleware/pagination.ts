import type { FastifyRequest, FastifyReply } from "fastify";
import {
  getPaginationParams,
  formatPaginatedResponse,
  buildLinkHeader,
  validatePaginationParams,
  type PaginationQuery,
  type PaginatedResponse,
} from "../../utils/pagination.js";

export interface PaginationRequestParams {
  page?: number;
  limit?: number;
  offset?: number;
  cursor?: string;
}

export function parsePagination(query: PaginationRequestParams) {
  const raw: PaginationQuery = {
    page: query.page,
    limit: query.limit,
    offset: query.offset,
    cursor: query.cursor,
  };
  return getPaginationParams(raw);
}

export function replyWithPage<T>(
  reply: FastifyReply,
  data: T[],
  total: number,
  page: number,
  limit: number,
  request?: FastifyRequest
): PaginatedResponse<T> {
  const validationError = validatePaginationParams(page, limit);
  if (validationError) {
    reply.code(400).send({ error: "Invalid pagination parameters", message: validationError });
    throw new Error(validationError);
  }

  const baseUrl = request
    ? `${request.protocol}://${request.hostname}${request.url.split("?")[0]}`
    : undefined;

  const extraParams: Record<string, string> = {};
  if (request) {
    const q = request.query as Record<string, string | undefined>;
    for (const [k, v] of Object.entries(q)) {
      if (k !== "page" && k !== "limit" && k !== "offset" && v !== undefined) {
        extraParams[k] = v;
      }
    }
  }

  const response = formatPaginatedResponse(data, total, page, limit, baseUrl, extraParams);

  if (response.links) {
    reply.header("Link", buildLinkHeader(response.links));
  }
  reply.header("X-Total-Count", String(total));
  reply.header("X-Total-Pages", String(response.meta.totalPages));
  reply.header("X-Current-Page", String(page));
  reply.header("X-Page-Limit", String(limit));

  return response;
}
