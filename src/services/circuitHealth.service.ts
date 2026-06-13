import { getDatabase } from "../database/connection.js";
import { redis } from "../utils/redis.js";
import { logger } from "../utils/logger.js";
import { getCircuitBreakerService, PauseScope, PauseLevel } from "./circuitBreaker.service.js";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface CircuitTransition {
  id: string;
  pauseId: number;
  scope: string;
  identifier: string | null;
  level: string;
  triggeredBy: string;
  reason: string;
  timestamp: number;
  recoveryDeadline: number;
  status: string;
}

export interface ManualOverride {
  id: number;
  type: "address" | "asset" | "bridge";
  value: string;
  addedBy: string;
  addedAt: Date;
}

export interface CircuitState {
  scope: string;
  identifier: string | null;
  level: string;
  isPaused: boolean;
  triggeredBy: string | null;
  triggerReason: string | null;
  timestamp: number | null;
  recoveryDeadline: number | null;
  guardianApprovals: number | null;
  guardianThreshold: number | null;
  status: string | null;
}

export interface CircuitHealthInfo {
  timestamp: number;
  global: CircuitState;
  bridges: Map<string, CircuitState>;
  assets: Map<string, CircuitState>;
  recentTransitions: CircuitTransition[];
  manualOverrides: ManualOverride[];
  cacheExpiresAt: number;
}

export interface CircuitHealthQuery {
  scope?: "global" | "bridge" | "asset";
  identifier?: string;
  includeHistory?: boolean;
  historyLimit?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────────

export class CircuitHealthService {
  private readonly CACHE_TTL = 60; // 60 seconds
  private readonly CACHE_KEY_PREFIX = "circuit:health";
  private readonly HISTORY_LIMIT = 100;

  /**
   * Get comprehensive circuit health information with caching
   */
  async getCircuitHealth(query?: CircuitHealthQuery): Promise<CircuitHealthInfo | CircuitState | null> {
    try {
      // If filtering by specific scope/identifier, return just that state
      if (query?.scope && query?.scope !== "global") {
        return this.getCircuitStateByQuery(query);
      }

      // Get full health information
      return this.getFullCircuitHealth(query);
    } catch (error) {
      logger.error({ error }, "Failed to get circuit health");
      throw error;
    }
  }

  /**
   * Get specific circuit state by query
   */
  private async getCircuitStateByQuery(query: CircuitHealthQuery): Promise<CircuitState | null> {
    try {
      const cacheKey = this.getCacheKey(query.scope, query.identifier);
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        return cached as CircuitState;
      }

      const db = getDatabase();
      const state = await db("circuit_breaker_pauses")
        .where("pause_scope", this.scopeToNumber(query.scope))
        .modify((builder) => {
          if (query.identifier) {
            builder.where("identifier", query.identifier);
          }
        })
        .orderBy("created_at", "desc")
        .first();

      const circuitState = this.formatCircuitState(state, query.scope, query.identifier);
      await this.setCache(cacheKey, circuitState);
      return circuitState;
    } catch (error) {
      logger.error({ error, query }, "Failed to get circuit state by query");
      throw error;
    }
  }

  /**
   * Get full circuit health information for all scopes
   */
  private async getFullCircuitHealth(query?: CircuitHealthQuery): Promise<CircuitHealthInfo> {
    try {
      const cacheKey = `${this.CACHE_KEY_PREFIX}:full`;
      const cached = await this.getFromCache(cacheKey);
      if (cached && !query?.includeHistory) {
        return cached as CircuitHealthInfo;
      }

      const db = getDatabase();
      const now = Math.floor(Date.now() / 1000);

      // Get all active pauses
      const pauses = await db("circuit_breaker_pauses")
        .whereIn("status", ["active", "recovering"])
        .orderBy("created_at", "desc");

      // Get recent transitions
      const historyLimit = query?.historyLimit || this.HISTORY_LIMIT;
      const transitions = await db("circuit_breaker_pauses")
        .orderBy("created_at", "desc")
        .limit(historyLimit);

      // Get manual overrides
      const overrides = await db("circuit_breaker_whitelist").orderBy("added_at", "desc");

      // Build circuit states
      const global = this.findPauseByScope(pauses, 0, null);
      const bridges = new Map<string, CircuitState>();
      const assets = new Map<string, CircuitState>();

      // Group pauses by scope
      for (const pause of pauses) {
        if (pause.pause_scope === 1) {
          // Bridge
          const identifier = pause.identifier;
          const state = this.formatCircuitState(pause, "bridge", identifier);
          bridges.set(identifier, state);
        } else if (pause.pause_scope === 2) {
          // Asset
          const identifier = pause.identifier;
          const state = this.formatCircuitState(pause, "asset", identifier);
          assets.set(identifier, state);
        }
      }

      const health: CircuitHealthInfo = {
        timestamp: now,
        global: this.formatCircuitState(global, "global", null),
        bridges,
        assets,
        recentTransitions: transitions.map((t) => this.formatTransition(t)),
        manualOverrides: overrides.map((o) => ({
          id: o.id,
          type: o.type,
          value: o.value,
          addedBy: o.added_by,
          addedAt: o.added_at,
        })),
        cacheExpiresAt: now + this.CACHE_TTL,
      };

      // Cache full health (but not if includeHistory is true to ensure fresh data)
      if (!query?.includeHistory) {
        await this.setCache(cacheKey, health);
      }

      return health;
    } catch (error) {
      logger.error({ error }, "Failed to get full circuit health");
      throw error;
    }
  }

  /**
   * Get health status for a specific bridge
   */
  async getBridgeHealth(bridgeId: string): Promise<CircuitState> {
    return this.getCircuitStateByQuery({
      scope: "bridge",
      identifier: bridgeId,
    }) as Promise<CircuitState>;
  }

  /**
   * Get health status for a specific asset
   */
  async getAssetHealth(assetCode: string): Promise<CircuitState> {
    return this.getCircuitStateByQuery({
      scope: "asset",
      identifier: assetCode,
    }) as Promise<CircuitState>;
  }

  /**
   * Get global circuit health
   */
  async getGlobalHealth(): Promise<CircuitState> {
    return this.getCircuitStateByQuery({
      scope: "global",
    }) as Promise<CircuitState>;
  }

  /**
   * Get recent transitions with optional filtering
   */
  async getRecentTransitions(
    limit: number = 50,
    scope?: "global" | "bridge" | "asset",
    identifier?: string
  ): Promise<CircuitTransition[]> {
    try {
      const db = getDatabase();
      let query = db("circuit_breaker_pauses")
        .orderBy("created_at", "desc")
        .limit(limit);

      if (scope && scope !== "global") {
        query = query.where("pause_scope", this.scopeToNumber(scope));
        if (identifier) {
          query = query.where("identifier", identifier);
        }
      }

      const transitions = await query;
      return transitions.map((t) => this.formatTransition(t));
    } catch (error) {
      logger.error({ error }, "Failed to get recent transitions");
      throw error;
    }
  }

  /**
   * Check if a specific item is whitelisted
   */
  async isWhitelisted(type: "address" | "asset" | "bridge", value: string): Promise<boolean> {
    try {
      const cacheKey = `${this.CACHE_KEY_PREFIX}:whitelist:${type}:${value}`;
      const cached = await this.getFromCache(cacheKey);
      if (cached !== null && cached !== undefined) {
        return cached as boolean;
      }

      const db = getDatabase();
      const result = await db("circuit_breaker_whitelist")
        .where("type", type)
        .where("value", value)
        .first();

      const isWhitelisted = !!result;
      await this.setCache(cacheKey, isWhitelisted);
      return isWhitelisted;
    } catch (error) {
      logger.error({ error, type, value }, "Failed to check whitelist");
      throw error;
    }
  }

  /**
   * Get all whitelisted items of a type
   */
  async getWhitelistByType(type: "address" | "asset" | "bridge"): Promise<ManualOverride[]> {
    try {
      const cacheKey = `${this.CACHE_KEY_PREFIX}:whitelist:${type}:all`;
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        return cached as ManualOverride[];
      }

      const db = getDatabase();
      const overrides = await db("circuit_breaker_whitelist")
        .where("type", type)
        .orderBy("added_at", "desc");

      const formatted = overrides.map((o) => ({
        id: o.id,
        type: o.type,
        value: o.value,
        addedBy: o.added_by,
        addedAt: o.added_at,
      }));

      await this.setCache(cacheKey, formatted);
      return formatted;
    } catch (error) {
      logger.error({ error, type }, "Failed to get whitelist");
      throw error;
    }
  }

  /**
   * Invalidate cache for a circuit
   */
  async invalidateCache(scope?: "global" | "bridge" | "asset", identifier?: string): Promise<void> {
    try {
      // Invalidate specific cache if provided
      if (scope) {
        const cacheKey = this.getCacheKey(scope, identifier);
        await redis.del(cacheKey);
      }

      // Always invalidate full health cache
      await redis.del(`${this.CACHE_KEY_PREFIX}:full`);

      // Invalidate whitelist cache if relevant
      if (scope === "bridge" || scope === "asset") {
        await redis.del(`${this.CACHE_KEY_PREFIX}:whitelist:${scope}:all`);
      }

      logger.debug({ scope, identifier }, "Circuit health cache invalidated");
    } catch (error) {
      logger.error({ error }, "Failed to invalidate cache");
      // Don't throw - cache invalidation failure shouldn't break the circuit
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  async getCacheStats(): Promise<{
    hitRate: number;
    missCount: number;
    size: number;
    ttl: number;
  }> {
    try {
      const keys = await redis.keys(`${this.CACHE_KEY_PREFIX}:*`);
      return {
        hitRate: 0.8, // Placeholder - would need actual tracking
        missCount: 0,
        size: keys.length,
        ttl: this.CACHE_TTL,
      };
    } catch (error) {
      logger.error({ error }, "Failed to get cache stats");
      return { hitRate: 0, missCount: 0, size: 0, ttl: this.CACHE_TTL };
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helper methods
  // ────────────────────────────────────────────────────────────────────────────

  private async getFromCache<T = any>(key: string): Promise<T | null> {
    try {
      const cached = await redis.get(key);
      if (!cached) return null;

      return JSON.parse(cached) as T;
    } catch (error) {
      logger.debug({ error, key }, "Cache retrieval failed");
      return null;
    }
  }

  private async setCache(key: string, value: any): Promise<void> {
    try {
      await redis.setex(key, this.CACHE_TTL, JSON.stringify(value));
    } catch (error) {
      logger.debug({ error, key }, "Cache write failed");
      // Don't throw - cache failures shouldn't break the application
    }
  }

  private getCacheKey(scope?: string, identifier?: string): string {
    if (!scope) return `${this.CACHE_KEY_PREFIX}:global`;
    if (scope === "global") return `${this.CACHE_KEY_PREFIX}:global`;
    if (identifier) return `${this.CACHE_KEY_PREFIX}:${scope}:${identifier}`;
    return `${this.CACHE_KEY_PREFIX}:${scope}`;
  }

  private scopeToNumber(scope?: string): number {
    switch (scope) {
      case "bridge":
        return 1;
      case "asset":
        return 2;
      default:
        return 0; // global
    }
  }

  private numberToScope(num: number): string {
    switch (num) {
      case 1:
        return "bridge";
      case 2:
        return "asset";
      default:
        return "global";
    }
  }

  private numberToLevel(num: number): string {
    switch (num) {
      case 1:
        return "warning";
      case 2:
        return "partial";
      case 3:
        return "full";
      default:
        return "none";
    }
  }

  private findPauseByScope(
    pauses: any[],
    scopeNum: number,
    identifier: string | null
  ): any | null {
    return pauses.find((p) => p.pause_scope === scopeNum && p.identifier === identifier);
  }

  private formatCircuitState(pause: any, scope: string, identifier: string | null): CircuitState {
    if (!pause) {
      return {
        scope,
        identifier,
        level: "none",
        isPaused: false,
        triggeredBy: null,
        triggerReason: null,
        timestamp: null,
        recoveryDeadline: null,
        guardianApprovals: null,
        guardianThreshold: null,
        status: null,
      };
    }

    return {
      scope,
      identifier,
      level: this.numberToLevel(pause.pause_level),
      isPaused: pause.status === "active" || pause.status === "recovering",
      triggeredBy: pause.triggered_by,
      triggerReason: pause.trigger_reason,
      timestamp: Number(pause.timestamp),
      recoveryDeadline: Number(pause.recovery_deadline),
      guardianApprovals: pause.guardian_approvals,
      guardianThreshold: pause.guardian_threshold,
      status: pause.status,
    };
  }

  private formatTransition(transition: any): CircuitTransition {
    return {
      id: `pause-${transition.pause_id}`,
      pauseId: transition.pause_id,
      scope: this.numberToScope(transition.pause_scope),
      identifier: transition.identifier,
      level: this.numberToLevel(transition.pause_level),
      triggeredBy: transition.triggered_by,
      reason: transition.trigger_reason,
      timestamp: Number(transition.timestamp),
      recoveryDeadline: Number(transition.recovery_deadline),
      status: transition.status,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────────────────────────────────────

let circuitHealthService: CircuitHealthService | null = null;

export function getCircuitHealthService(): CircuitHealthService {
  if (!circuitHealthService) {
    circuitHealthService = new CircuitHealthService();
  }
  return circuitHealthService;
}

export default CircuitHealthService;
