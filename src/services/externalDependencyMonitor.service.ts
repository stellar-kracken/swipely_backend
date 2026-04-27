import { getDatabase } from "../database/connection.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

export type ExternalDependencyStatus =
  | "healthy"
  | "degraded"
  | "down"
  | "maintenance"
  | "unknown";

export interface ExternalDependencyCheck {
  id: string;
  providerKey: string;
  status: ExternalDependencyStatus;
  checkedAt: string;
  latencyMs: number | null;
  statusCode: number | null;
  withinThreshold: boolean;
  alertTriggered: boolean;
  error: string | null;
  details: Record<string, unknown>;
}

export interface ExternalDependency {
  providerKey: string;
  displayName: string;
  category: string;
  endpoint: string;
  checkType: "http" | "jsonrpc";
  latencyWarningMs: number;
  latencyCriticalMs: number;
  failureThreshold: number;
  maintenanceMode: boolean;
  maintenanceNote: string | null;
  status: ExternalDependencyStatus;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  alertState: "none" | "firing" | "suppressed";
  history?: ExternalDependencyCheck[];
}

interface ProviderDefinition {
  providerKey: string;
  displayName: string;
  category: string;
  endpoint: string;
  checkType: "http" | "jsonrpc";
  latencyWarningMs: number;
  latencyCriticalMs: number;
  failureThreshold: number;
}

interface RunCheckResult {
  providerKey: string;
  status: ExternalDependencyStatus;
  latencyMs: number | null;
  statusCode: number | null;
  withinThreshold: boolean;
  alertTriggered: boolean;
  error: string | null;
  details: Record<string, unknown>;
}

const CHECK_TIMEOUT_MS = 5_000;

export class ExternalDependencyMonitorService {
  private readonly db = getDatabase();

  async listDependencies(options: {
    includeHistory?: boolean;
    historyLimit?: number;
  } = {}): Promise<{
    dependencies: ExternalDependency[];
    summary: Record<ExternalDependencyStatus, number>;
  }> {
    await this.ensureInventory();

    const rows = await this.db("external_dependencies")
      .select("*")
      .orderBy([{ column: "category", order: "asc" }, { column: "display_name", order: "asc" }]);

    const dependencies = rows.map((row) => this.mapDependency(row));

    if (options.includeHistory) {
      const historyByProvider = await this.getRecentHistoryForProviders(
        dependencies.map((item) => item.providerKey),
        options.historyLimit ?? 10
      );

      for (const dependency of dependencies) {
        dependency.history = historyByProvider.get(dependency.providerKey) ?? [];
      }
    }

    const summary: Record<ExternalDependencyStatus, number> = {
      healthy: 0,
      degraded: 0,
      down: 0,
      maintenance: 0,
      unknown: 0,
    };

    for (const dependency of dependencies) {
      summary[dependency.status] += 1;
    }

    return { dependencies, summary };
  }

  async getDependencyHistory(
    providerKey: string,
    limit = 50
  ): Promise<ExternalDependencyCheck[]> {
    await this.ensureInventory();

    const rows = await this.db("external_dependency_checks")
      .where({ provider_key: providerKey })
      .orderBy("checked_at", "desc")
      .limit(limit);

    return rows.map((row) => this.mapCheck(row));
  }

  async runAllChecks(reason: "scheduled" | "manual" = "scheduled"): Promise<RunCheckResult[]> {
    await this.ensureInventory();

    const dependencies = await this.db("external_dependencies").select("*");
    const results = await Promise.all(
      dependencies.map((dependency) => this.runSingleCheck(dependency, reason))
    );

    logger.info(
      {
        reason,
        total: results.length,
        unhealthy: results.filter((result) => result.status === "down").length,
        degraded: results.filter((result) => result.status === "degraded").length,
      },
      "Completed external dependency checks"
    );

    return results;
  }

  async setMaintenanceMode(
    providerKey: string,
    maintenanceMode: boolean,
    note?: string | null
  ): Promise<ExternalDependency | null> {
    await this.ensureInventory();

    const [row] = await this.db("external_dependencies")
      .where({ provider_key: providerKey })
      .update({
        maintenance_mode: maintenanceMode,
        maintenance_note: maintenanceMode ? (note ?? null) : null,
        status: maintenanceMode ? "maintenance" : "unknown",
        updated_at: new Date(),
      })
      .returning("*");

    return row ? this.mapDependency(row) : null;
  }

  private async ensureInventory(): Promise<void> {
    const providers = this.getProviderDefinitions();
    if (providers.length === 0) {
      return;
    }

    await this.db("external_dependencies")
      .insert(
        providers.map((provider) => ({
          provider_key: provider.providerKey,
          display_name: provider.displayName,
          category: provider.category,
          endpoint: provider.endpoint,
          check_type: provider.checkType,
          latency_warning_ms: provider.latencyWarningMs,
          latency_critical_ms: provider.latencyCriticalMs,
          failure_threshold: provider.failureThreshold,
        }))
      )
      .onConflict("provider_key")
      .merge({
        display_name: this.db.raw("excluded.display_name"),
        category: this.db.raw("excluded.category"),
        endpoint: this.db.raw("excluded.endpoint"),
        check_type: this.db.raw("excluded.check_type"),
        latency_warning_ms: this.db.raw("excluded.latency_warning_ms"),
        latency_critical_ms: this.db.raw("excluded.latency_critical_ms"),
        failure_threshold: this.db.raw("excluded.failure_threshold"),
        updated_at: this.db.fn.now(),
      });
  }

  private getProviderDefinitions(): ProviderDefinition[] {
    const providers: ProviderDefinition[] = [
      {
        providerKey: "stellar-horizon",
        displayName: "Stellar Horizon",
        category: "core-rpc",
        endpoint: config.STELLAR_HORIZON_URL,
        checkType: "http",
        latencyWarningMs: 750,
        latencyCriticalMs: 2_000,
        failureThreshold: 2,
      },
      {
        providerKey: "soroban-rpc",
        displayName: "Soroban RPC",
        category: "core-rpc",
        endpoint: config.SOROBAN_RPC_URL,
        checkType: "jsonrpc",
        latencyWarningMs: 1_000,
        latencyCriticalMs: 2_500,
        failureThreshold: 2,
      },
      {
        providerKey: "coingecko",
        displayName: "CoinGecko",
        category: "price-provider",
        endpoint: "https://api.coingecko.com/api/v3/ping",
        checkType: "http",
        latencyWarningMs: 1_200,
        latencyCriticalMs: 3_000,
        failureThreshold: 3,
      },
    ];

    const rpcProviders = [
      ["ethereum-rpc", "Ethereum RPC", config.ETHEREUM_RPC_URL],
      ["polygon-rpc", "Polygon RPC", config.POLYGON_RPC_URL],
      ["base-rpc", "Base RPC", config.BASE_RPC_URL],
    ] as const;

    for (const [providerKey, displayName, endpoint] of rpcProviders) {
      if (!endpoint) continue;
      providers.push({
        providerKey,
        displayName,
        category: "evm-rpc",
        endpoint,
        checkType: "jsonrpc",
        latencyWarningMs: 1_250,
        latencyCriticalMs: 3_000,
        failureThreshold: 3,
      });
    }

    return providers;
  }

  private async runSingleCheck(
    dependencyRow: Record<string, unknown>,
    reason: "scheduled" | "manual"
  ): Promise<RunCheckResult> {
    const dependency = this.mapDependency(dependencyRow);
    const checkedAt = new Date();

    if (dependency.maintenanceMode) {
      const maintenanceResult: RunCheckResult = {
        providerKey: dependency.providerKey,
        status: "maintenance",
        latencyMs: null,
        statusCode: null,
        withinThreshold: false,
        alertTriggered: false,
        error: dependency.maintenanceNote ?? "Maintenance mode enabled",
        details: {
          reason,
          maintenanceNote: dependency.maintenanceNote,
        },
      };

      await this.persistCheckResult(dependency, maintenanceResult, checkedAt);
      return maintenanceResult;
    }

    const start = Date.now();
    let response: Response | null = null;
    let error: Error | null = null;

    try {
      response = await this.performRequest(dependency);
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }

    const latencyMs = Date.now() - start;
    const statusCode = response?.status ?? null;
    const baseStatus = this.determineStatus(response, latencyMs, dependency, error);
    const withinThreshold =
      baseStatus === "healthy" && latencyMs <= dependency.latencyWarningMs;
    const nextConsecutiveFailures = baseStatus === "healthy"
      ? 0
      : dependency.consecutiveFailures + 1;
    const alertTriggered =
      baseStatus !== "healthy" && nextConsecutiveFailures >= dependency.failureThreshold;

    const result: RunCheckResult = {
      providerKey: dependency.providerKey,
      status: baseStatus,
      latencyMs,
      statusCode,
      withinThreshold,
      alertTriggered,
      error: error?.message ?? null,
      details: {
        reason,
        endpoint: dependency.endpoint,
        category: dependency.category,
      },
    };

    await this.persistCheckResult(dependency, result, checkedAt);

    if (alertTriggered) {
      logger.warn(
        {
          providerKey: dependency.providerKey,
          status: result.status,
          consecutiveFailures: nextConsecutiveFailures,
          latencyMs,
          statusCode,
        },
        "External dependency alert threshold reached"
      );
    }

    return result;
  }

  private async performRequest(dependency: ExternalDependency): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

    try {
      if (dependency.checkType === "jsonrpc") {
        return await fetch(dependency.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method:
              dependency.providerKey === "soroban-rpc" ? "getHealth" : "eth_blockNumber",
            params: [],
          }),
          signal: controller.signal,
        });
      }

      return await fetch(dependency.endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private determineStatus(
    response: Response | null,
    latencyMs: number,
    dependency: ExternalDependency,
    error: Error | null
  ): ExternalDependencyStatus {
    if (error) {
      return "down";
    }
    if (!response) {
      return "down";
    }
    if (response.status >= 500) {
      return "down";
    }
    if (latencyMs > dependency.latencyCriticalMs) {
      return "down";
    }
    if (response.status >= 400 || latencyMs > dependency.latencyWarningMs) {
      return "degraded";
    }
    return "healthy";
  }

  private async persistCheckResult(
    dependency: ExternalDependency,
    result: RunCheckResult,
    checkedAt: Date
  ): Promise<void> {
    const nextConsecutiveFailures =
      result.status === "healthy" || result.status === "maintenance"
        ? 0
        : dependency.consecutiveFailures + 1;

    await this.db.transaction(async (trx) => {
      await trx("external_dependency_checks").insert({
        provider_key: dependency.providerKey,
        checked_at: checkedAt,
        status: result.status,
        latency_ms: result.latencyMs,
        status_code: result.statusCode,
        within_threshold: result.withinThreshold,
        alert_triggered: result.alertTriggered,
        error: result.error,
        details: JSON.stringify(result.details),
      });

      await trx("external_dependencies")
        .where({ provider_key: dependency.providerKey })
        .update({
          status: result.status,
          last_checked_at: checkedAt,
          last_latency_ms: result.latencyMs,
          consecutive_failures: nextConsecutiveFailures,
          last_success_at: result.status === "healthy" ? checkedAt : dependency.lastSuccessAt,
          last_failure_at:
            result.status === "down" || result.status === "degraded"
              ? checkedAt
              : dependency.lastFailureAt,
          last_error: result.error,
          updated_at: checkedAt,
        });
    });
  }

  private async getRecentHistoryForProviders(
    providerKeys: string[],
    historyLimit: number
  ): Promise<Map<string, ExternalDependencyCheck[]>> {
    const historyByProvider = new Map<string, ExternalDependencyCheck[]>();
    if (providerKeys.length === 0) {
      return historyByProvider;
    }

    const rows = await this.db("external_dependency_checks")
      .whereIn("provider_key", providerKeys)
      .orderBy("checked_at", "desc");

    for (const row of rows) {
      const providerKey = String(row.provider_key);
      const existing = historyByProvider.get(providerKey) ?? [];
      if (existing.length >= historyLimit) {
        continue;
      }
      existing.push(this.mapCheck(row));
      historyByProvider.set(providerKey, existing);
    }

    return historyByProvider;
  }

  private mapDependency(row: Record<string, unknown>): ExternalDependency {
    const status = this.normalizeStatus(row.status);
    const maintenanceMode = Boolean(row.maintenance_mode);

    return {
      providerKey: String(row.provider_key),
      displayName: String(row.display_name),
      category: String(row.category),
      endpoint: String(row.endpoint),
      checkType: String(row.check_type) === "jsonrpc" ? "jsonrpc" : "http",
      latencyWarningMs: Number(row.latency_warning_ms),
      latencyCriticalMs: Number(row.latency_critical_ms),
      failureThreshold: Number(row.failure_threshold),
      maintenanceMode,
      maintenanceNote: row.maintenance_note ? String(row.maintenance_note) : null,
      status: maintenanceMode ? "maintenance" : status,
      lastCheckedAt: row.last_checked_at ? new Date(String(row.last_checked_at)).toISOString() : null,
      lastLatencyMs: row.last_latency_ms === null || row.last_latency_ms === undefined
        ? null
        : Number(row.last_latency_ms),
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      lastSuccessAt: row.last_success_at ? new Date(String(row.last_success_at)).toISOString() : null,
      lastFailureAt: row.last_failure_at ? new Date(String(row.last_failure_at)).toISOString() : null,
      lastError: row.last_error ? String(row.last_error) : null,
      alertState: maintenanceMode
        ? "suppressed"
        : status === "healthy" || status === "unknown"
        ? "none"
        : Number(row.consecutive_failures ?? 0) >= Number(row.failure_threshold ?? 0)
        ? "firing"
        : "none",
    };
  }

  private mapCheck(row: Record<string, unknown>): ExternalDependencyCheck {
    const details =
      typeof row.details === "string"
        ? (JSON.parse(row.details) as Record<string, unknown>)
        : ((row.details as Record<string, unknown>) ?? {});

    return {
      id: String(row.id),
      providerKey: String(row.provider_key),
      status: this.normalizeStatus(row.status),
      checkedAt: new Date(String(row.checked_at)).toISOString(),
      latencyMs: row.latency_ms === null || row.latency_ms === undefined
        ? null
        : Number(row.latency_ms),
      statusCode: row.status_code === null || row.status_code === undefined
        ? null
        : Number(row.status_code),
      withinThreshold: Boolean(row.within_threshold),
      alertTriggered: Boolean(row.alert_triggered),
      error: row.error ? String(row.error) : null,
      details,
    };
  }

  private normalizeStatus(value: unknown): ExternalDependencyStatus {
    switch (value) {
      case "healthy":
      case "degraded":
      case "down":
      case "maintenance":
        return value;
      default:
        return "unknown";
    }
  }
}
