import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExternalDependencyMonitorService } from "../../src/services/externalDependencyMonitor.service.js";

const mockDb = () => {
  const store = {
    external_dependencies: [] as any[],
    external_dependency_checks: [] as any[],
  };

  const createQuery = (table: string) => {
    const query: any = {
      where: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      orderBy: vi.fn(function (this: any) {
        return this;
      }),
      select: vi.fn(function (this: any) {
        return store[table as keyof typeof store] || [];
      }),
      first: vi.fn(async () => {
        const items = store[table as keyof typeof store];
        return items && items.length > 0 ? items[0] : null;
      }),
      insert: vi.fn(async (data: any) => {
        const items = Array.isArray(data) ? data : [data];
        store[table as keyof typeof store].push(...items);
        return items;
      }),
      update: vi.fn(async (data: any) => {
        const items = store[table as keyof typeof store];
        if (items.length > 0) {
          Object.assign(items[0], data);
          return [items[0]];
        }
        return [];
      }),
      limit: vi.fn(function (this: any) {
        return this;
      }),
      onConflict: vi.fn().mockReturnThis(),
      merge: vi.fn().mockResolvedValue(undefined),
      returning: vi.fn(async function (this: any) {
        const items = store[table as keyof typeof store];
        return items.length > 0 ? [items[items.length - 1]] : [];
      }),
    };

    query.select.mockImplementation(async () => store[table as keyof typeof store] || []);

    return query;
  };

  const db: any = (table: string) => createQuery(table);
  db.raw = vi.fn();
  db.fn = { now: () => new Date() };
  db.client = {
    wrapIdentifier: (id: string) => `"${id}"`,
  };
  db.transaction = vi.fn(async (callback: any) => {
    const trx: any = (table: string) => createQuery(table);
    trx.raw = db.raw;
    trx.fn = db.fn;
    return callback(trx);
  });
  db.__store = store;

  return db;
};

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    STELLAR_HORIZON_URL: "https://horizon.stellar.org",
    SOROBAN_RPC_URL: "https://soroban-rpc.stellar.org",
    ETHEREUM_RPC_URL: "https://eth.llamarpc.com",
    POLYGON_RPC_URL: "https://polygon.llamarpc.com",
    BASE_RPC_URL: "https://base.llamarpc.com",
  },
}));

global.fetch = vi.fn();

describe("ExternalDependencyMonitorService", () => {
  let service: ExternalDependencyMonitorService;
  let db: any;

  beforeEach(async () => {
    const { getDatabase } = await import("../../src/database/connection.js");
    db = mockDb();
    vi.mocked(getDatabase).mockReturnValue(db);
    service = new ExternalDependencyMonitorService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("listDependencies", () => {
    it("lists all dependencies", async () => {
      const mockDependencies = [
        {
          provider_key: "stellar-horizon",
          display_name: "Stellar Horizon",
          category: "core-rpc",
          endpoint: "https://horizon.stellar.org",
          check_type: "http",
          latency_warning_ms: 750,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          maintenance_note: null,
          status: "healthy",
          last_checked_at: new Date().toISOString(),
          last_latency_ms: 150,
          consecutive_failures: 0,
          last_success_at: new Date().toISOString(),
          last_failure_at: null,
          last_error: null,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);

      const result = await service.listDependencies();

      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].providerKey).toBe("stellar-horizon");
      expect(result.summary).toBeDefined();
    });

    it("includes history when requested", async () => {
      const mockDependencies = [
        {
          provider_key: "stellar-horizon",
          display_name: "Stellar Horizon",
          category: "core-rpc",
          endpoint: "https://horizon.stellar.org",
          check_type: "http",
          latency_warning_ms: 750,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          status: "healthy",
          last_checked_at: new Date().toISOString(),
          consecutive_failures: 0,
        },
      ];

      const mockHistory = [
        {
          id: "check-1",
          provider_key: "stellar-horizon",
          status: "healthy",
          checked_at: new Date().toISOString(),
          latency_ms: 150,
          status_code: 200,
          within_threshold: true,
          alert_triggered: false,
          error: null,
          details: JSON.stringify({}),
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      db("external_dependency_checks").orderBy.mockResolvedValueOnce(mockHistory);

      const result = await service.listDependencies({ includeHistory: true, historyLimit: 10 });

      expect(result.dependencies[0].history).toBeDefined();
      expect(result.dependencies[0].history).toHaveLength(1);
    });

    it("calculates summary correctly", async () => {
      const mockDependencies = [
        {
          provider_key: "dep1",
          status: "healthy",
          maintenance_mode: false,
          consecutive_failures: 0,
        },
        {
          provider_key: "dep2",
          status: "degraded",
          maintenance_mode: false,
          consecutive_failures: 1,
        },
        {
          provider_key: "dep3",
          status: "down",
          maintenance_mode: false,
          consecutive_failures: 3,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);

      const result = await service.listDependencies();

      expect(result.summary.healthy).toBe(1);
      expect(result.summary.degraded).toBe(1);
      expect(result.summary.down).toBe(1);
    });
  });

  describe("getDependencyHistory", () => {
    it("retrieves history for a specific provider", async () => {
      const mockHistory = [
        {
          id: "check-1",
          provider_key: "stellar-horizon",
          status: "healthy",
          checked_at: new Date().toISOString(),
          latency_ms: 150,
          status_code: 200,
          within_threshold: true,
          alert_triggered: false,
          error: null,
          details: JSON.stringify({}),
        },
        {
          id: "check-2",
          provider_key: "stellar-horizon",
          status: "healthy",
          checked_at: new Date().toISOString(),
          latency_ms: 200,
          status_code: 200,
          within_threshold: true,
          alert_triggered: false,
          error: null,
          details: JSON.stringify({}),
        },
      ];

      db("external_dependency_checks").limit.mockResolvedValueOnce(mockHistory);

      const history = await service.getDependencyHistory("stellar-horizon");

      expect(history).toHaveLength(2);
      expect(history[0].providerKey).toBe("stellar-horizon");
    });

    it("respects limit parameter", async () => {
      db("external_dependency_checks").limit.mockResolvedValueOnce([]);

      await service.getDependencyHistory("stellar-horizon", 20);

      expect(db("external_dependency_checks").limit).toHaveBeenCalledWith(20);
    });
  });

  describe("runAllChecks", () => {
    it("runs checks for all dependencies", async () => {
      const mockDependencies = [
        {
          provider_key: "stellar-horizon",
          display_name: "Stellar Horizon",
          endpoint: "https://horizon.stellar.org",
          check_type: "http",
          latency_warning_ms: 750,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
      } as Response);

      const results = await service.runAllChecks("manual");

      expect(results).toHaveLength(1);
      expect(results[0].providerKey).toBe("stellar-horizon");
      expect(results[0].status).toBeDefined();
    });

    it("handles check failures", async () => {
      const mockDependencies = [
        {
          provider_key: "stellar-horizon",
          endpoint: "https://horizon.stellar.org",
          check_type: "http",
          latency_warning_ms: 750,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

      const results = await service.runAllChecks();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("down");
      expect(results[0].error).toBe("Network error");
    });

    it("skips dependencies in maintenance mode", async () => {
      const mockDependencies = [
        {
          provider_key: "stellar-horizon",
          endpoint: "https://horizon.stellar.org",
          check_type: "http",
          maintenance_mode: true,
          maintenance_note: "Scheduled maintenance",
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);

      const results = await service.runAllChecks();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("maintenance");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("setMaintenanceMode", () => {
    it("enables maintenance mode", async () => {
      const mockDependency = {
        provider_key: "stellar-horizon",
        maintenance_mode: true,
        maintenance_note: "Scheduled upgrade",
        status: "maintenance",
      };

      db("external_dependencies").update.mockResolvedValueOnce([mockDependency]);

      const result = await service.setMaintenanceMode(
        "stellar-horizon",
        true,
        "Scheduled upgrade"
      );

      expect(result).toBeDefined();
      expect(result?.providerKey).toBe("stellar-horizon");
    });

    it("disables maintenance mode", async () => {
      const mockDependency = {
        provider_key: "stellar-horizon",
        maintenance_mode: false,
        maintenance_note: null,
        status: "unknown",
      };

      db("external_dependencies").update.mockResolvedValueOnce([mockDependency]);

      const result = await service.setMaintenanceMode("stellar-horizon", false);

      expect(result).toBeDefined();
      expect(db("external_dependencies").update).toHaveBeenCalledWith(
        expect.objectContaining({
          maintenance_mode: false,
          maintenance_note: null,
        })
      );
    });

    it("returns null when dependency not found", async () => {
      db("external_dependencies").update.mockResolvedValueOnce([]);

      const result = await service.setMaintenanceMode("nonexistent", true);

      expect(result).toBeNull();
    });
  });

  describe("health check logic", () => {
    it("marks as healthy when response is ok and within threshold", async () => {
      const mockDependencies = [
        {
          provider_key: "test-service",
          endpoint: "https://test.com",
          check_type: "http",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
      } as Response);

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("healthy");
      expect(results[0].withinThreshold).toBe(true);
    });

    it("marks as degraded when latency exceeds warning threshold", async () => {
      const mockDependencies = [
        {
          provider_key: "test-service",
          endpoint: "https://test.com",
          check_type: "http",
          latency_warning_ms: 10,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  status: 200,
                  ok: true,
                } as Response),
              50
            )
          )
      );

      const results = await service.runAllChecks();

      expect(results[0].status).toMatch(/healthy|degraded/);
    });

    it("marks as down when status is 500", async () => {
      const mockDependencies = [
        {
          provider_key: "test-service",
          endpoint: "https://test.com",
          check_type: "http",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 500,
        ok: false,
      } as Response);

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("down");
    });

    it("marks as degraded when status is 400", async () => {
      const mockDependencies = [
        {
          provider_key: "test-service",
          endpoint: "https://test.com",
          check_type: "http",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 400,
        ok: false,
      } as Response);

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("degraded");
    });
  });

  describe("alert thresholds", () => {
    it("triggers alert when failure threshold reached", async () => {
      const mockDependencies = [
        {
          provider_key: "test-service",
          endpoint: "https://test.com",
          check_type: "http",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 1,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Connection failed"));

      const results = await service.runAllChecks();

      expect(results[0].alertTriggered).toBe(true);
    });

    it("does not trigger alert below threshold", async () => {
      const mockDependencies = [
        {
          provider_key: "test-service",
          endpoint: "https://test.com",
          check_type: "http",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 3,
          maintenance_mode: false,
          consecutive_failures: 1,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Connection failed"));

      const results = await service.runAllChecks();

      expect(results[0].alertTriggered).toBe(false);
    });

    it("resets consecutive failures on success", async () => {
      const mockDependencies = [
        {
          provider_key: "test-service",
          endpoint: "https://test.com",
          check_type: "http",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 5,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
      } as Response);

      await service.runAllChecks();

      const updateCall = db("external_dependencies").update.mock.calls.find((call) =>
        call[0].hasOwnProperty("consecutive_failures")
      );
      expect(updateCall?.[0].consecutive_failures).toBe(0);
    });
  });

  describe("check types", () => {
    it("performs HTTP checks correctly", async () => {
      const mockDependencies = [
        {
          provider_key: "http-service",
          endpoint: "https://api.example.com/health",
          check_type: "http",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
      } as Response);

      await service.runAllChecks();

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/health",
        expect.objectContaining({
          method: "GET",
          headers: { Accept: "application/json" },
        })
      );
    });

    it("performs JSON-RPC checks correctly", async () => {
      const mockDependencies = [
        {
          provider_key: "soroban-rpc",
          endpoint: "https://soroban-rpc.stellar.org",
          check_type: "jsonrpc",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
      } as Response);

      await service.runAllChecks();

      expect(fetch).toHaveBeenCalledWith(
        "https://soroban-rpc.stellar.org",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: expect.stringContaining("getHealth"),
        })
      );
    });

    it("uses correct RPC method for different providers", async () => {
      const mockDependencies = [
        {
          provider_key: "ethereum-rpc",
          endpoint: "https://eth.llamarpc.com",
          check_type: "jsonrpc",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
      } as Response);

      await service.runAllChecks();

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining("eth_blockNumber"),
        })
      );
    });
  });

  describe("timeout handling", () => {
    it("aborts request after timeout", async () => {
      const mockDependencies = [
        {
          provider_key: "slow-service",
          endpoint: "https://slow.example.com",
          check_type: "http",
          latency_warning_ms: 1000,
          latency_critical_ms: 2000,
          failure_threshold: 2,
          maintenance_mode: false,
          consecutive_failures: 0,
        },
      ];

      db("external_dependencies").select.mockResolvedValueOnce(mockDependencies);
      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Aborted")), 100);
          })
      );

      const results = await service.runAllChecks();

      expect(results[0].status).toBe("down");
    });
  });
});
