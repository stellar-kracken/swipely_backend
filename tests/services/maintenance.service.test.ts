import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MaintenanceService } from "../../src/services/maintenance.service.js";

// Every db() call records its builder so tests can assert on insert/update args.
let builders: any[] = [];

const createQueryBuilder = (rows: any[] = [], firstRow?: any) => {
  const builder: any = {
    insert: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orWhere: vi.fn(() => builder),
    andWhere: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    update: vi.fn(async () => 1),
    first: vi.fn(async () => firstRow ?? rows[0]),
    then: (resolve: (value: any) => any) => resolve(rows),
  };
  builders.push(builder);
  return builder;
};

const mockKnex = vi.hoisted(() => vi.fn());

vi.mock("../../src/database/connection", () => ({
  getDatabase: () => mockKnex,
}));

const baseWindow = {
  title: "DB upgrade",
  description: "Primary DB version bump",
  scope: "global" as const,
  scope_identifier: null,
  start_time: new Date("2030-01-01T00:00:00Z"),
  end_time: new Date("2030-01-01T02:00:00Z"),
  suppress_alerts: true,
  alert_types_suppressed: ["depeg", "reserve_drift"],
  created_by: "ops@bridgewatch",
  timezone: "UTC",
};

describe("MaintenanceService", () => {
  let service: MaintenanceService;

  beforeEach(() => {
    service = new MaintenanceService();
    builders = [];
    mockKnex.mockReset();
    mockKnex.mockImplementation(() => createQueryBuilder([]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createWindow", () => {
    it("creates a scheduled window with a generated id and writes an audit log", async () => {
      const result = await service.createWindow(baseWindow);

      expect(result.id).toMatch(/^[0-9a-f]{32}$/);
      expect(result.status).toBe("scheduled");
      expect(result.approved_by).toBeNull();
      // alert_types_suppressed is returned as the original array, not the JSON string
      expect(result.alert_types_suppressed).toEqual(["depeg", "reserve_drift"]);

      expect(mockKnex).toHaveBeenCalledWith("maintenance_windows");
      expect(mockKnex).toHaveBeenCalledWith("maintenance_audit_logs");

      const insertCall = builders.find((b) => b.insert.mock.calls.length > 0);
      expect(insertCall.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "scheduled",
          alert_types_suppressed: JSON.stringify(baseWindow.alert_types_suppressed),
        }),
      );
    });

    it("rethrows when the insert fails", async () => {
      mockKnex.mockImplementation(() => {
        throw new Error("insert failed");
      });
      await expect(service.createWindow(baseWindow)).rejects.toThrow("insert failed");
    });
  });

  describe("getWindow", () => {
    it("returns the window with a parsed alert_types_suppressed array", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([], {
          id: "w1",
          title: "x",
          alert_types_suppressed: JSON.stringify(["depeg"]),
        }),
      );

      const window = await service.getWindow("w1");
      expect(window?.id).toBe("w1");
      expect(window?.alert_types_suppressed).toEqual(["depeg"]);
    });

    it("returns null when the window does not exist", async () => {
      mockKnex.mockImplementation(() => createQueryBuilder([], undefined));
      expect(await service.getWindow("missing")).toBeNull();
    });

    it("returns null when the query throws", async () => {
      mockKnex.mockImplementation(() => {
        throw new Error("db down");
      });
      expect(await service.getWindow("w1")).toBeNull();
    });
  });

  describe("shouldSuppressAlert", () => {
    it("suppresses when an active window covers the alert type", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          { id: "w1", alert_types_suppressed: JSON.stringify(["depeg"]) },
        ]),
      );
      expect(await service.shouldSuppressAlert("depeg")).toBe(true);
    });

    it("suppresses every alert type for a wildcard window", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          { id: "w1", alert_types_suppressed: JSON.stringify(["*"]) },
        ]),
      );
      expect(await service.shouldSuppressAlert("anything")).toBe(true);
    });

    it("does not suppress an unrelated alert type", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          { id: "w1", alert_types_suppressed: JSON.stringify(["reserve_drift"]) },
        ]),
      );
      expect(await service.shouldSuppressAlert("depeg")).toBe(false);
    });

    it("scopes the query when a scope is provided", async () => {
      mockKnex.mockImplementation(() => createQueryBuilder([]));
      expect(
        await service.shouldSuppressAlert("depeg", {
          type: "bridge",
          identifier: "circle-usdc",
        }),
      ).toBe(false);
    });

    it("returns false when the check throws", async () => {
      mockKnex.mockImplementation(() => {
        throw new Error("boom");
      });
      expect(await service.shouldSuppressAlert("depeg")).toBe(false);
    });
  });

  describe("getActiveWindows / getUpcomingWindows", () => {
    it("returns active windows with parsed suppression arrays", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          { id: "w1", alert_types_suppressed: JSON.stringify(["*"]) },
          { id: "w2", alert_types_suppressed: null },
        ]),
      );
      const windows = await service.getActiveWindows();
      expect(windows).toHaveLength(2);
      expect(windows[0].alert_types_suppressed).toEqual(["*"]);
      expect(windows[1].alert_types_suppressed).toEqual([]);
    });

    it("returns [] when active-window lookup throws", async () => {
      mockKnex.mockImplementation(() => {
        throw new Error("nope");
      });
      expect(await service.getActiveWindows()).toEqual([]);
    });

    it("applies the limit to upcoming windows", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          { id: "w1", alert_types_suppressed: JSON.stringify([]) },
        ]),
      );
      const windows = await service.getUpcomingWindows(5);
      expect(windows).toHaveLength(1);
      const limited = builders.find((b) => b.limit.mock.calls.length > 0);
      expect(limited.limit).toHaveBeenCalledWith(5);
    });
  });

  describe("approveWindow / cancelWindow", () => {
    it("approves a window and records the approver", async () => {
      await service.approveWindow("w1", "lead@bridgewatch");
      const updated = builders.find((b) => b.update.mock.calls.length > 0);
      expect(updated.update).toHaveBeenCalledWith(
        expect.objectContaining({ approved_by: "lead@bridgewatch" }),
      );
    });

    it("cancels a window by setting status=cancelled", async () => {
      await service.cancelWindow("w1", "ops@bridgewatch");
      const updated = builders.find((b) => b.update.mock.calls.length > 0);
      expect(updated.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "cancelled" }),
      );
    });
  });

  describe("processWindowTransitions", () => {
    it("starts scheduled windows whose start time has passed", async () => {
      // First db() call (the to-start SELECT) yields one scheduled window;
      // every later call (updates, audit insert, to-complete SELECT) is empty.
      mockKnex.mockImplementationOnce(() =>
        createQueryBuilder([{ id: "w1" }]),
      );

      await service.processWindowTransitions();

      const startedUpdate = builders.some((b) =>
        b.update.mock.calls.some((c: any[]) => c[0]?.status === "active"),
      );
      expect(startedUpdate).toBe(true);
    });

    it("swallows errors and does not throw", async () => {
      mockKnex.mockImplementation(() => {
        throw new Error("transition failed");
      });
      await expect(service.processWindowTransitions()).resolves.toBeUndefined();
    });
  });

  describe("getAllWindows", () => {
    it("returns mapped windows and applies status/scope filters", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          { id: "w1", alert_types_suppressed: JSON.stringify(["depeg"]) },
        ]),
      );

      const windows = await service.getAllWindows({
        status: "active",
        scope: "global",
      });

      expect(windows).toHaveLength(1);
      expect(windows[0].alert_types_suppressed).toEqual(["depeg"]);
      const builder = builders.find((b) => b.where.mock.calls.length > 0);
      expect(builder.where).toHaveBeenCalledWith("status", "active");
      expect(builder.where).toHaveBeenCalledWith("scope", "global");
    });
  });
});
