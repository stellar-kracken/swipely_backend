import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { auditService } from "./audit.service.js";

export interface ProviderAllowlistEntry {
  providerKey: string;
  displayName: string;
  category: string;
  allowed: boolean;
  reason: string | null;
  createdBy: string;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
}

interface UpsertInput {
  providerKey: string;
  displayName?: string | null;
  category?: string | null;
  allowed: boolean;
  reason?: string | null;
  actorId: string;
  actorType?: "user" | "api_key" | "system";
  ipAddress?: string | null;
  userAgent?: string | null;
}

function normalizeProviderKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function mapEntry(row: Record<string, unknown>): ProviderAllowlistEntry {
  return {
    providerKey: String(row.provider_key),
    displayName: String(row.display_name),
    category: String(row.category),
    allowed: Boolean(row.allowed),
    reason: row.reason ? String(row.reason) : null,
    createdBy: String(row.created_by),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedBy: String(row.updated_by),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

export class ProviderAllowlistService {
  private db = getDatabase();

  async listEntries(): Promise<ProviderAllowlistEntry[]> {
    const rows = await this.db("provider_allowlist")
      .select("*")
      .orderBy("provider_key", "asc");
    return rows.map(mapEntry);
  }

  async getEntry(providerKey: string): Promise<ProviderAllowlistEntry | null> {
    const key = normalizeProviderKey(providerKey);
    const row = await this.db("provider_allowlist")
      .where({ provider_key: key })
      .first();
    return row ? mapEntry(row) : null;
  }

  async isAllowed(providerKey: string): Promise<boolean> {
    const key = normalizeProviderKey(providerKey);
    if (!key) return false;

    try {
      const anyEntry = await this.db("provider_allowlist")
        .first("provider_key");
      if (!anyEntry) {
        return true;
      }

      const row = await this.db("provider_allowlist")
        .where({ provider_key: key })
        .first();

      return row ? Boolean(row.allowed) : false;
    } catch (error) {
      logger.warn({ error, providerKey: key }, "Provider allowlist check failed; allowing by default");
      return true;
    }
  }

  async upsertEntry(input: UpsertInput): Promise<ProviderAllowlistEntry> {
    const key = normalizeProviderKey(input.providerKey);
    const now = new Date();

    const existing = await this.db("provider_allowlist")
      .where({ provider_key: key })
      .first();

    if (existing) {
      const [row] = await this.db("provider_allowlist")
        .where({ provider_key: key })
        .update({
          display_name: input.displayName ?? existing.display_name,
          category: input.category ?? existing.category,
          allowed: input.allowed,
          reason: input.reason ?? existing.reason ?? null,
          updated_by: input.actorId,
          updated_at: now,
        })
        .returning("*");

      const updated = mapEntry(row);

      await auditService.log({
        action: "admin.provider_allowlist_changed",
        actorId: input.actorId,
        actorType: input.actorType ?? "api_key",
        ipAddress: input.ipAddress ?? undefined,
        userAgent: input.userAgent ?? undefined,
        resourceType: "provider_allowlist",
        resourceId: key,
        before: mapEntry(existing) as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
        metadata: {
          reason: input.reason ?? null,
        },
      });

      return updated;
    }

    const [row] = await this.db("provider_allowlist")
      .insert({
        provider_key: key,
        display_name: input.displayName ?? key,
        category: input.category ?? "unknown",
        allowed: input.allowed,
        reason: input.reason ?? null,
        created_by: input.actorId,
        created_at: now,
        updated_by: input.actorId,
        updated_at: now,
      })
      .returning("*");

    const created = mapEntry(row);

    await auditService.log({
      action: "admin.provider_allowlist_changed",
      actorId: input.actorId,
      actorType: input.actorType ?? "api_key",
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
      resourceType: "provider_allowlist",
      resourceId: key,
      after: created as unknown as Record<string, unknown>,
      metadata: {
        reason: input.reason ?? null,
      },
    });

    return created;
  }

  async deleteEntry(input: {
    providerKey: string;
    actorId: string;
    actorType?: "user" | "api_key" | "system";
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<boolean> {
    const key = normalizeProviderKey(input.providerKey);
    const existing = await this.db("provider_allowlist")
      .where({ provider_key: key })
      .first();

    if (!existing) return false;

    await this.db("provider_allowlist")
      .where({ provider_key: key })
      .delete();

    await auditService.log({
      action: "admin.provider_allowlist_changed",
      actorId: input.actorId,
      actorType: input.actorType ?? "api_key",
      ipAddress: input.ipAddress ?? undefined,
      userAgent: input.userAgent ?? undefined,
      resourceType: "provider_allowlist",
      resourceId: key,
      before: mapEntry(existing) as unknown as Record<string, unknown>,
      after: null,
      metadata: {
        reason: "deleted",
      },
    });

    return true;
  }
}

export const providerAllowlistService = new ProviderAllowlistService();
