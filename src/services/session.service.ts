import { randomBytes, createHash } from "node:crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { getPaginationParams, formatPaginatedResponse, type PaginatedResponse } from "../utils/pagination.js";

export type SessionStatus = "active" | "expired" | "revoked";

export interface UserSession {
  id: string;
  userId: string;
  deviceId: string | null;
  deviceName: string | null;
  deviceType: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  status: SessionStatus;
  expiresAt: string;
  lastActiveAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionAuditEntry {
  id: number;
  sessionId: string;
  userId: string;
  action: string;
  actor: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateSessionInput {
  userId: string;
  deviceId?: string;
  deviceName?: string;
  deviceType?: string;
  userAgent?: string;
  ipAddress?: string;
  ttlSeconds?: number;
}

export interface SessionListOptions {
  userId?: string;
  status?: SessionStatus;
  page?: number;
  limit?: number;
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSIONS_TABLE = "user_sessions";
const AUDIT_TABLE = "session_audit_log";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toPublicSession(row: Record<string, unknown>): UserSession {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    deviceId: (row.device_id as string | null) ?? null,
    deviceName: (row.device_name as string | null) ?? null,
    deviceType: (row.device_type as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
    ipAddress: (row.ip_address as string | null) ?? null,
    status: row.status as SessionStatus,
    expiresAt: row.expires_at as string,
    lastActiveAt: row.last_active_at as string,
    revokedAt: (row.revoked_at as string | null) ?? null,
    revokedReason: (row.revoked_reason as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SessionService {
  private db = getDatabase();

  async createSession(
    input: CreateSessionInput
  ): Promise<{ session: UserSession; token: string }> {
    const token = randomBytes(32).toString("hex");
    const id = randomBytes(16).toString("hex");
    const tokenHash = hashToken(token);
    const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    const row = {
      id,
      user_id: input.userId,
      token_hash: tokenHash,
      device_id: input.deviceId ?? null,
      device_name: input.deviceName ?? null,
      device_type: input.deviceType ?? null,
      user_agent: input.userAgent ?? null,
      ip_address: input.ipAddress ?? null,
      status: "active" as SessionStatus,
      expires_at: expiresAt.toISOString(),
      last_active_at: now.toISOString(),
      revoked_at: null,
      revoked_reason: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    await this.db(SESSIONS_TABLE).insert(row);
    await this.addAudit(id, input.userId, "created", input.userId, input.ipAddress);

    logger.info({ sessionId: id, userId: input.userId }, "Session created");
    return { session: toPublicSession(row), token };
  }

  async validateSession(token: string): Promise<UserSession | null> {
    const tokenHash = hashToken(token);
    const row = await this.db(SESSIONS_TABLE).where("token_hash", tokenHash).first();

    if (!row) return null;

    const now = new Date();

    if (row.status === "revoked") return null;

    if (new Date(row.expires_at) < now) {
      await this.db(SESSIONS_TABLE)
        .where("id", row.id)
        .update({ status: "expired", updated_at: now.toISOString() });
      return null;
    }

    await this.db(SESSIONS_TABLE)
      .where("id", row.id)
      .update({ last_active_at: now.toISOString(), updated_at: now.toISOString() });

    return toPublicSession({ ...row, last_active_at: now.toISOString() });
  }

  async getSessionById(id: string): Promise<UserSession | null> {
    const row = await this.db(SESSIONS_TABLE).where("id", id).first();
    return row ? toPublicSession(row) : null;
  }

  async listSessions(options: SessionListOptions): Promise<PaginatedResponse<UserSession>> {
    const { limit, offset, page } = getPaginationParams({
      page: options.page,
      limit: options.limit,
    });

    const query = this.db(SESSIONS_TABLE);
    if (options.userId) query.where("user_id", options.userId);
    if (options.status) query.where("status", options.status);

    const [{ count }] = await query.clone().count("id as count");
    const total = Number(count);

    const rows = await query.orderBy("created_at", "desc").limit(limit).offset(offset);

    return formatPaginatedResponse(rows.map(toPublicSession), total, page, limit);
  }

  async revokeSession(
    id: string,
    actor: string,
    reason?: string,
    ipAddress?: string
  ): Promise<boolean> {
    const row = await this.db(SESSIONS_TABLE).where("id", id).first();
    if (!row || row.status !== "active") return false;

    const now = new Date().toISOString();
    await this.db(SESSIONS_TABLE).where("id", id).update({
      status: "revoked",
      revoked_at: now,
      revoked_reason: reason ?? "manual",
      updated_at: now,
    });

    await this.addAudit(id, row.user_id, "revoked", actor, ipAddress, { reason });
    logger.info({ sessionId: id, actor, reason }, "Session revoked");
    return true;
  }

  async revokeAllUserSessions(
    userId: string,
    actor: string,
    exceptSessionId?: string,
    ipAddress?: string
  ): Promise<number> {
    const now = new Date().toISOString();
    const query = this.db(SESSIONS_TABLE)
      .where("user_id", userId)
      .where("status", "active");

    if (exceptSessionId) query.whereNot("id", exceptSessionId);

    const rows = await query.clone().select("id");
    if (rows.length === 0) return 0;

    await query.update({
      status: "revoked",
      revoked_at: now,
      revoked_reason: "bulk-revoke",
      updated_at: now,
    });

    for (const row of rows) {
      await this.addAudit(row.id, userId, "revoked", actor, ipAddress, { bulk: true });
    }

    logger.info({ userId, count: rows.length, actor }, "Bulk session revoke");
    return rows.length;
  }

  async purgeExpiredSessions(): Promise<number> {
    const now = new Date().toISOString();
    const count = await this.db(SESSIONS_TABLE)
      .where("status", "active")
      .where("expires_at", "<", now)
      .update({ status: "expired", updated_at: now });

    if (count > 0) {
      logger.info({ count }, "Expired sessions purged");
    }
    return count;
  }

  async getAuditLog(sessionId: string): Promise<SessionAuditEntry[]> {
    const rows = await this.db(AUDIT_TABLE)
      .where("session_id", sessionId)
      .orderBy("created_at", "desc");

    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as number,
      sessionId: r.session_id as string,
      userId: r.user_id as string,
      action: r.action as string,
      actor: (r.actor as string | null) ?? null,
      ipAddress: (r.ip_address as string | null) ?? null,
      metadata:
        typeof r.metadata === "string"
          ? JSON.parse(r.metadata)
          : (r.metadata as Record<string, unknown> | null) ?? null,
      createdAt: r.created_at as string,
    }));
  }

  private async addAudit(
    sessionId: string,
    userId: string,
    action: string,
    actor?: string | null,
    ipAddress?: string | null,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.db(AUDIT_TABLE).insert({
      session_id: sessionId,
      user_id: userId,
      action,
      actor: actor ?? null,
      ip_address: ipAddress ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      created_at: new Date().toISOString(),
    });
  }
}
