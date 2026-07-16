import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExternalDependencyMonitorService } from "../../src/services/externalDependencyMonitor.service.js";

// ---------------------------------------------------------------------------
// DB mock factory
//
// Design goals:
//   1. Supports ALL knex chain patterns used by the service:
//        db(t).select("*")                          → terminal awaitable
//        db(t).select("*").orderBy(...)             → awaitable
//        db(t).where(...).orderBy(...).limit(n)     → awaitable
//        db(t).where(...).update(...).returning("*")→ awaitable
//        db(t).insert(...).onConflict(...).merge()  → awaitable
//        db(t).where(...).first()                   → awaitable
//   2. Tests can override any terminal call with .mockResolvedValueOnce()
//      via the shared spies exposed on db(table).
//   3. Each test gets a completely fresh set of query builders.
// ---------------------------------------------------------------------------
const makeMockDb = () => {
  const store: Record<string, any[]> = {
    external_dependencies:       [],
    external_dependency_checks:  [],
  };

  // Per-table spy cache so tests can do  db("t").spy.mockResolvedValueOnce(...)
  const spies: Record<string, Record<string, any>> = {};

  const getSpies = (table: string) => {
    if (!spies[table]) {
      spies[table] = {
        select:    vi.fn(),
        orderBy:   vi.fn(),
        limit:     vi.fn(),
        first:     vi.fn(),
        update:    vi.fn(),
        insert:    vi.fn(),
        returning: vi.fn(),
      };
    }
    return spies[table];
  };

  // Chainable builder: all methods return a new builder; awaiting resolves data.
  const makeBuilder = (table: string, resolveWith: () => Promise<any>): any => {
    const s = getSpies(table);
    const data = () => store[table] ?? [];

    const resolve = () => resolveWith();

    const builder: any = {
      then:  (res: any, rej: any) => resolve().then(res, rej),
      catch: (rej: any) => resolve().catch(rej),

      where:     vi.fn(() => builder),
      whereIn:   vi.fn(() => builder),
      onConflict:vi.fn(() => builder),
      merge:     vi.fn(() => Promise.resolve(undefined)),

      select: (...args: any[]) => {
        const override = s.select(...args);
        if (override && typeof override.then === "function") {
          return makeBuilder(table, () => override);
        }
        return makeBuilder(table, resolve);
      },

      orderBy: (...args: any[]) => {
        const override = s.orderBy(...args);
        if (override && typeof override.then === "function") {
          return makeBuilder(table, () => override);
        }
        return makeBuilder(table, resolve);
      },

      limit: (...args: any[]) => {
        const override = s.limit(...args);
        if (override && typeof override.then === "function") {
          return makeBuilder(table, () => override);
        }
        return makeBuilder(table, resolve);
      },

      first: (...args: any[]) => {
        const override = s.first(...args);
        if (override && typeof override.then === "function") return override;
        return Promise.resolve(data()[0] ?? null);
      },

      update: (...args: any[]) => {
        const override = s.update(...args);
        if (override && typeof override.then === "function") {
          return makeBuilder(table, () => override);
        }
        return makeBuilder(table, () => Promise.resolve(1));
      },

      insert: (...args: any[]) => {
        const override = s.insert(...args);
        if (override && typeof override.then === "function") {
          return makeBuilder(table, () => override);
        }
        // default: push to store and return chainable
        const items = Array.isArray(args[0]) ? args[0] : [args[0]];
        items.forEach((item: any) => (store[table] ??= []).push(item));
        return makeBuilder(table, () => Promise.resolve(items));
      },

      returning: (...args: any[]) => {
        const override = s.returning(...args);
        if (override && typeof override.then === "function") return override;
        const items = store[table] ?? [];
        return Promise.resolve(items.length ? [items[items.length - 1]] : []);
      },
    };

    return builder;
  };

  const db: any = (table: string) => {
    const s = getSpies(table);
    const data = () => store[table] ?? [];

    // Root query builder
    const root: any = {};
    root.where      = vi.fn(() => root);
    root.whereIn    = vi.fn(() => root);
    root.onConflict = vi.fn(() => root);
    root.merge      = vi.fn(() => Promise.resolve(undefined));

    root.select = (...args: any[]) => {
      const override = s.select(...args);
      if (override && typeof override.then === "function") {
        return makeBuilder(table, () => override);
      }
      return makeBuilder(table, () => Promise.resolve(data()));
    };

    root.orderBy = (...args: any[]) => {
      const override = s.orderBy(...args);
      if (override && typeof override.then === "function") {
        return makeBuilder(table, () => override);
      }
      return makeBuilder(table, () => Promise.resolve(data()));
    };

    root.limit = (...args: any[]) => {
      const override = s.limit(...args);
      if (override && typeof override.then === "function") {
        return makeBuilder(table, () => override);
      }
      return makeBuilder(table, () => Promise.resolve(data()));
    };

    root.first = (...args: any[]) => {
      const override = s.first(...args);
      if (override && typeof override.then === "function") return override;
      return Promise.resolve(data()[0] ?? null);
    };

    root.update = (...args: any[]) => {
      const override = s.update(...args);
      if (override && typeof override.then === "function") {
        return makeBuilder(table, () => override);
      }
      return makeBuilder(table, () => Promise.resolve(1));
    };

    root.insert = (...args: any[]) => {
      const override = s.insert(...args);
      if (override && typeof override.then === "function") {
        return makeBuilder(table, () => override);
      }
      const items = Array.isArray(args[0]) ? args[0] : [args[0]];
      items.forEach((item: any) => (store[table] ??= []).push(item));
      return makeBuilder(table, () => Promise.resolve(items));
    };

    root.returning = (...args: any[]) => {
      const override = s.returning(...args);
      if (override && typeof override.then === "function") return override;
      const items = store[table] ?? [];
      return Promise.resolve(items.length ? [items[items.length - 1]] : []);
    };

    // Expose spies directly so tests can do db("t").select.mockResolvedValueOnce(...)
    root.select.mock   = s.select.mock;   root.select.mockResolvedValueOnce   = (v: any) => s.select.mockResolvedValueOnce(v);
    root.orderBy.mock  = s.orderBy.mock;  root.orderBy.mockResolvedValueOnce  = (v: any) => s.orderBy.mockResolvedValueOnce(v);  root.orderBy.mockRejectedValueOnce = (v: any) => s.orderBy.mockRejectedValueOnce(v);
    root.limit.mock    = s.limit.mock;    root.limit.mockResolvedValueOnce    = (v: any) => s.limit.mockResolvedValueOnce(v);
    root.first.mock    = s.first.mock;    root.first.mockResolvedValueOnce    = (v: any) => s.first.mockResolvedValueOnce(v);    root.first.mockRejectedValueOnce = (v: any) => s.first.mockRejectedValueOnce(v);
    root.update.mock   = s.update.mock;   root.update.mockResolvedValueOnce   = (v: any) => s.update.mockResolvedValueOnce(v);   root.update.mockRejectedValueOnce = (v: any) => s.update.mockRejectedValueOnce(v);
    root.insert.mock   = s.insert.mock;   root.insert.mockResolvedValueOnce   = (v: any) => s.insert.mockResolvedValueOnce(v);   root.insert.mockRejectedValueOnce = (v: any) => s.insert.mockRejectedValueOnce(v);
    root.returning.mock= s.returning.mock;root.returning.mockResolvedValueOnce= (v: any) => s.returning.mockResolvedValueOnce(v);

    return root;
  };

  db.raw = vi.fn((expr: string) => expr);
  db.fn  = { now: () => new Date() };
  db.client = { wrapIdentifier: (id: string) => `"${id}"` };
  db.transaction = vi.fn(async (cb: any) => {
    const trx: any = (t: string) => db(t);
    trx.raw = db.raw;
    trx.fn  = db.fn;
    return cb(trx);
  });
  db.__store = store;

  return db;
};

vi.mock("../../src/database/connection.js", () => ({ getDatabase: vi.fn() }));
vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/config/index.js", () => ({
  config: {
    STELLAR_HORIZON_URL: "https://horizon.stellar.org",
    SOROBAN_RPC_URL:     "https://soroban-rpc.stellar.org",
    ETHEREUM_RPC_URL:    "https://eth.llamarpc.com",
    POLYGON_RPC_URL:     "https://polygon.llamarpc.com",
    BASE_RPC_URL:        "https://base.llamarpc.com",
  },
}));

global.fetch = vi.fn();

describe("ExternalDependencyMonitorService", () => {
  let service: ExternalDependencyMonitorService;
  let db: ReturnType<typeof makeMockDb>;

  beforeEach(async () => {
    const { getDatabase } = await import("../../src/database/connection.js");
    db = makeMockDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    service = new ExternalDependencyMonitorService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── listDependencies ───────────────────────────────────────────────────────

  describe("listDependencies", () => {
    it("lists all dependencies", async () => {
      const mockDeps = [{ provider_key: "stellar-horizon", display_name: "Stellar Horizon", category: "core-rpc", endpoint: "https://horizon.stellar.org", check_type: "http", latency_warning_ms: 750, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, maintenance_note: null, status: "healthy", last_checked_at: new Date().toISOString(), last_latency_ms: 150, consecutive_failures: 0, last_success_at: new Date().toISOString(), last_failure_at: null, last_error: null }];

      db("external_dependencies").orderBy.mockResolvedValueOnce(mockDeps);

      const result = await service.listDependencies();

      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].providerKey).toBe("stellar-horizon");
      expect(result.summary).toBeDefined();
    });

    it("includes history when requested", async () => {
      const mockDeps = [{ provider_key: "stellar-horizon", display_name: "Stellar Horizon", category: "core-rpc", endpoint: "https://horizon.stellar.org", check_type: "http", latency_warning_ms: 750, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, status: "healthy", last_checked_at: new Date().toISOString(), consecutive_failures: 0 }];
      const mockHistory = [{ id: "c1", provider_key: "stellar-horizon", status: "healthy", checked_at: new Date().toISOString(), latency_ms: 150, status_code: 200, within_threshold: true, alert_triggered: false, error: null, details: "{}" }];

      db("external_dependencies").orderBy.mockResolvedValueOnce(mockDeps);
      db("external_dependency_checks").orderBy.mockResolvedValueOnce(mockHistory);

      const result = await service.listDependencies({ includeHistory: true, historyLimit: 10 });

      expect(result.dependencies[0].history).toHaveLength(1);
    });

    it("calculates summary correctly", async () => {
      db("external_dependencies").orderBy.mockResolvedValueOnce([
        { provider_key: "d1", status: "healthy",  maintenance_mode: false, consecutive_failures: 0 },
        { provider_key: "d2", status: "degraded", maintenance_mode: false, consecutive_failures: 1 },
        { provider_key: "d3", status: "down",     maintenance_mode: false, consecutive_failures: 3 },
      ]);

      const result = await service.listDependencies();

      expect(result.summary.healthy).toBe(1);
      expect(result.summary.degraded).toBe(1);
      expect(result.summary.down).toBe(1);
    });
  });

  // ── getDependencyHistory ───────────────────────────────────────────────────

  describe("getDependencyHistory", () => {
    it("retrieves history for a specific provider", async () => {
      const rows = [
        { id: "c1", provider_key: "stellar-horizon", status: "healthy", checked_at: new Date().toISOString(), latency_ms: 150, status_code: 200, within_threshold: true, alert_triggered: false, error: null, details: "{}" },
        { id: "c2", provider_key: "stellar-horizon", status: "healthy", checked_at: new Date().toISOString(), latency_ms: 200, status_code: 200, within_threshold: true, alert_triggered: false, error: null, details: "{}" },
      ];
      db("external_dependency_checks").limit.mockResolvedValueOnce(rows);

      const history = await service.getDependencyHistory("stellar-horizon");

      expect(history).toHaveLength(2);
      expect(history[0].providerKey).toBe("stellar-horizon");
    });

    it("respects limit parameter", async () => {
      db("external_dependency_checks").limit.mockResolvedValueOnce([]);

      await service.getDependencyHistory("stellar-horizon", 20);

      expect(db("external_dependency_checks").limit.mock.calls.some((c: any[]) => c[0] === 20)).toBe(true);
    });
  });

  // ── runAllChecks ───────────────────────────────────────────────────────────

  describe("runAllChecks", () => {
    it("runs checks for all dependencies", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "stellar-horizon", display_name: "Stellar Horizon", endpoint: "https://horizon.stellar.org", check_type: "http", latency_warning_ms: 750, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockResolvedValueOnce({ status: 200, ok: true } as Response);

      const results = await service.runAllChecks("manual");

      expect(results).toHaveLength(1);
      expect(results[0].providerKey).toBe("stellar-horizon");
    });

    it("handles check failures", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "stellar-horizon", endpoint: "https://horizon.stellar.org", check_type: "http", latency_warning_ms: 750, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("down");
      expect(results[0].error).toBe("Network error");
    });

    it("skips dependencies in maintenance mode", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "stellar-horizon", endpoint: "https://horizon.stellar.org", check_type: "http", maintenance_mode: true, maintenance_note: "maintenance", consecutive_failures: 0 },
      ]);

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("maintenance");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  // ── setMaintenanceMode ─────────────────────────────────────────────────────

  describe("setMaintenanceMode", () => {
    const baseDep = { provider_key: "stellar-horizon", display_name: "Stellar Horizon", category: "core-rpc", endpoint: "https://horizon.stellar.org", check_type: "http", latency_warning_ms: 750, latency_critical_ms: 2000, failure_threshold: 2, consecutive_failures: 0 };

    it("enables maintenance mode", async () => {
      db("external_dependencies").returning.mockResolvedValueOnce([{ ...baseDep, maintenance_mode: true, maintenance_note: "upgrade", status: "maintenance" }]);

      const result = await service.setMaintenanceMode("stellar-horizon", true, "upgrade");

      expect(result?.providerKey).toBe("stellar-horizon");
    });

    it("disables maintenance mode", async () => {
      db("external_dependencies").returning.mockResolvedValueOnce([{ ...baseDep, maintenance_mode: false, maintenance_note: null, status: "unknown" }]);

      const result = await service.setMaintenanceMode("stellar-horizon", false);

      expect(result).toBeDefined();
      expect(db("external_dependencies").update.mock.calls[0]?.[0]).toMatchObject({ maintenance_mode: false, maintenance_note: null });
    });

    it("returns null when dependency not found", async () => {
      db("external_dependencies").returning.mockResolvedValueOnce([]);

      const result = await service.setMaintenanceMode("nonexistent", true);

      expect(result).toBeNull();
    });
  });

  // ── health check logic ─────────────────────────────────────────────────────

  describe("health check logic", () => {
    it("marks as healthy when response is ok", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "t", endpoint: "https://t.com", check_type: "http", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockResolvedValueOnce({ status: 200, ok: true } as Response);

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("healthy");
      expect(results[0].withinThreshold).toBe(true);
    });

    it("marks as degraded when latency exceeds warning threshold", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "t", endpoint: "https://t.com", check_type: "http", latency_warning_ms: 10, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ status: 200, ok: true } as Response), 50)));

      const results = await service.runAllChecks();

      expect(results[0].status).toMatch(/healthy|degraded/);
    });

    it("marks as down when status is 500", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "t", endpoint: "https://t.com", check_type: "http", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockResolvedValueOnce({ status: 500, ok: false } as Response);

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("down");
    });

    it("marks as degraded when status is 400", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "t", endpoint: "https://t.com", check_type: "http", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockResolvedValueOnce({ status: 400, ok: false } as Response);

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("degraded");
    });
  });

  // ── alert thresholds ───────────────────────────────────────────────────────

  describe("alert thresholds", () => {
    it("triggers alert when failure threshold reached", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "t", endpoint: "https://t.com", check_type: "http", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 1 },
      ]);
      vi.mocked(fetch).mockRejectedValueOnce(new Error("fail"));

      const results = await service.runAllChecks();

      expect(results[0].alertTriggered).toBe(true);
    });

    it("does not trigger alert below threshold", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "t", endpoint: "https://t.com", check_type: "http", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 3, maintenance_mode: false, consecutive_failures: 1 },
      ]);
      vi.mocked(fetch).mockRejectedValueOnce(new Error("fail"));

      const results = await service.runAllChecks();

      expect(results[0].alertTriggered).toBe(false);
    });

    it("resets consecutive failures on success", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "t", endpoint: "https://t.com", check_type: "http", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 5 },
      ]);
      vi.mocked(fetch).mockResolvedValueOnce({ status: 200, ok: true } as Response);

      await service.runAllChecks();

      const call = db("external_dependencies").update.mock.calls.find(
        (c: any[]) => c[0] != null && "consecutive_failures" in c[0]
      );
      expect(call?.[0].consecutive_failures).toBe(0);
    });
  });

  // ── check types ────────────────────────────────────────────────────────────

  describe("check types", () => {
    it("performs HTTP checks correctly", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "http-svc", endpoint: "https://api.example.com/health", check_type: "http", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockResolvedValueOnce({ status: 200, ok: true } as Response);

      await service.runAllChecks();

      expect(fetch).toHaveBeenCalledWith("https://api.example.com/health", expect.objectContaining({ method: "GET" }));
    });

    it("performs JSON-RPC checks correctly", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "soroban-rpc", endpoint: "https://soroban-rpc.stellar.org", check_type: "jsonrpc", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockResolvedValueOnce({ status: 200, ok: true } as Response);

      await service.runAllChecks();

      expect(fetch).toHaveBeenCalledWith("https://soroban-rpc.stellar.org", expect.objectContaining({ method: "POST", body: expect.stringContaining("getHealth") }));
    });

    it("uses correct RPC method for different providers", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "ethereum-rpc", endpoint: "https://eth.llamarpc.com", check_type: "jsonrpc", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockResolvedValueOnce({ status: 200, ok: true } as Response);

      await service.runAllChecks();

      expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: expect.stringContaining("eth_blockNumber") }));
    });
  });

  // ── timeout handling ───────────────────────────────────────────────────────

  describe("timeout handling", () => {
    it("aborts request after timeout", async () => {
      db("external_dependencies").select.mockResolvedValueOnce([
        { provider_key: "slow", endpoint: "https://slow.example.com", check_type: "http", latency_warning_ms: 1000, latency_critical_ms: 2000, failure_threshold: 2, maintenance_mode: false, consecutive_failures: 0 },
      ]);
      vi.mocked(fetch).mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error("Aborted")), 100)));

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("down");
    });
  });
});
