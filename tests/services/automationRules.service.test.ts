import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationRulesService } from "../../src/services/automationRules.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/services/audit.service.js", () => ({
  auditService: {
    log: vi.fn().mockResolvedValue({}),
  },
}));

function createMockDb(rows: Record<string, unknown>[] = []) {
  const db: Record<string, any> = {};
  let result = rows;

  db.where = vi.fn().mockReturnValue(db);
  db.whereILike = vi.fn().mockReturnValue(db);
  db.whereRaw = vi.fn().mockReturnValue(db);
  db.orWhereILike = vi.fn().mockReturnValue(db);
  db.orWhereRaw = vi.fn().mockReturnValue(db);
  db.orderBy = vi.fn().mockReturnValue(db);
  db.limit = vi.fn().mockReturnValue(db);
  db.offset = vi.fn().mockResolvedValue(result);
  db.insert = vi.fn().mockReturnValue(db);
  db.update = vi.fn().mockReturnValue(db);
  db.delete = vi.fn().mockResolvedValue(1);
  db.count = vi.fn().mockReturnValue(db);
  db.first = vi.fn().mockResolvedValue(null);
  db.clone = vi.fn().mockReturnValue(db);
  db.select = vi.fn().mockReturnValue(db);
  db.groupBy = vi.fn().mockReturnValue(db);
  db.raw = vi.fn((expr: string) => expr);
  db.returning = vi.fn().mockResolvedValue(result);

  return { db, setResult: (r: Record<string, unknown>[]) => { result = r; db.offset = vi.fn().mockResolvedValue(result); } };
}

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const { db } = createMockDb();
    return vi.fn(() => db) as any;
  }),
}));

describe("AutomationRulesService", () => {
  let service: AutomationRulesService;

  beforeEach(() => {
    (AutomationRulesService as any).instance = undefined;
    service = AutomationRulesService.getInstance();
  });

  const actor = { id: "user-1", type: "user" as const };

  describe("createRule", () => {
    it("creates a rule and returns it", async () => {
      const mockDb = createMockDb([
        {
          id: "rule-1",
          name: "Test Rule",
          description: null,
          asset_code: "USDC",
          conditions: "[]",
          logic_operator: "AND",
          actions: "[]",
          status: "active",
          owner_address: "owner-1",
          cooldown_seconds: 3600,
          last_executed_at: null,
          execution_count: 0,
          version: 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);
      vi.mocked((await import("../../src/database/connection.js")).getDatabase).mockReturnValue(
        vi.fn(() => mockDb.db) as any
      );

      const rule = await service.createRule(
        {
          name: "Test Rule",
          assetCode: "USDC",
          conditions: [],
          logicOperator: "AND",
          actions: [],
          ownerAddress: "owner-1",
          status: "active",
        },
        actor
      );

      expect(rule.id).toBe("rule-1");
      expect(rule.name).toBe("Test Rule");
      expect(rule.version).toBe(1);
      expect(mockDb.db.insert).toHaveBeenCalled();
    });
  });

  describe("getRule", () => {
    it("returns null when rule not found", async () => {
      const mockDb = createMockDb([]);
      mockDb.db.first.mockResolvedValue(null);
      vi.mocked((await import("../../src/database/connection.js")).getDatabase).mockReturnValue(
        vi.fn(() => mockDb.db) as any
      );

      const rule = await service.getRule("missing-id");
      expect(rule).toBeNull();
    });
  });

  describe("listRules", () => {
    it("returns paginated rules", async () => {
      const mockDb = createMockDb([
        {
          id: "rule-1",
          name: "Rule 1",
          description: null,
          asset_code: "USDC",
          conditions: "[]",
          logic_operator: "AND",
          actions: "[]",
          status: "active",
          owner_address: "owner-1",
          cooldown_seconds: 3600,
          last_executed_at: null,
          execution_count: 0,
          version: 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);
      mockDb.db.first.mockResolvedValue({ count: "1" });
      vi.mocked((await import("../../src/database/connection.js")).getDatabase).mockReturnValue(
        vi.fn(() => mockDb.db) as any
      );

      const result = await service.listRules({ ownerAddress: "owner-1" });
      expect(result.rules).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe("updateRule", () => {
    it("returns null when rule not found", async () => {
      const mockDb = createMockDb([]);
      mockDb.db.first.mockResolvedValue(null);
      vi.mocked((await import("../../src/database/connection.js")).getDatabase).mockReturnValue(
        vi.fn(() => mockDb.db) as any
      );

      const rule = await service.updateRule("missing-id", { name: "New Name" }, actor);
      expect(rule).toBeNull();
    });
  });

  describe("deleteRule", () => {
    it("returns false when rule not found", async () => {
      const mockDb = createMockDb([]);
      mockDb.db.first.mockResolvedValue(null);
      vi.mocked((await import("../../src/database/connection.js")).getDatabase).mockReturnValue(
        vi.fn(() => mockDb.db) as any
      );

      const deleted = await service.deleteRule("missing-id", actor);
      expect(deleted).toBe(false);
    });
  });

  describe("getRuleHistory", () => {
    it("returns paginated history", async () => {
      const mockDb = createMockDb([
        {
          id: "version-1",
          rule_id: "rule-1",
          version: 1,
          snapshot: "{}",
          changed_by: "user-1",
          change_type: "create",
          change_reason: null,
          created_at: new Date(),
        },
      ]);
      mockDb.db.first.mockResolvedValue({ count: "1" });
      vi.mocked((await import("../../src/database/connection.js")).getDatabase).mockReturnValue(
        vi.fn(() => mockDb.db) as any
      );

      const result = await service.getRuleHistory({ ruleId: "rule-1" });
      expect(result.versions).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.versions[0].changeType).toBe("create");
    });
  });

  describe("getExecutionHistory", () => {
    it("returns paginated execution history", async () => {
      const mockDb = createMockDb([
        {
          id: "exec-1",
          rule_id: "rule-1",
          rule_version: 1,
          input_metrics: "{}",
          condition_results: "[]",
          triggered: true,
          actions_executed: null,
          action_results: null,
          status: "completed",
          error_message: null,
          executed_by: "system",
          started_at: new Date(),
          completed_at: new Date(),
          duration_ms: 100,
          created_at: new Date(),
        },
      ]);
      mockDb.db.first.mockResolvedValue({ count: "1" });
      vi.mocked((await import("../../src/database/connection.js")).getDatabase).mockReturnValue(
        vi.fn(() => mockDb.db) as any
      );

      const result = await service.getExecutionHistory({ ruleId: "rule-1" });
      expect(result.executions).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.executions[0].triggered).toBe(true);
    });
  });

  describe("searchRuleHistory", () => {
    it("searches by query string", async () => {
      const mockDb = createMockDb([
        {
          id: "version-1",
          rule_id: "rule-1",
          version: 1,
          snapshot: "{}",
          changed_by: "user-1",
          change_type: "create",
          change_reason: null,
          created_at: new Date(),
        },
      ]);
      mockDb.db.first.mockResolvedValue({ count: "1" });
      vi.mocked((await import("../../src/database/connection.js")).getDatabase).mockReturnValue(
        vi.fn(() => mockDb.db) as any
      );

      const result = await service.searchRuleHistory({ q: "create" });
      expect(result.versions).toHaveLength(1);
      expect(mockDb.db.where).toHaveBeenCalled();
    });
  });

  describe("compareVersions", () => {
    it("returns null when versions not found", async () => {
      const mockDb = createMockDb([]);
      mockDb.db.first.mockResolvedValue(null);
      vi.mocked((await import("../../src/database/connection.js")).getDatabase).mockReturnValue(
        vi.fn(() => mockDb.db) as any
      );

      const comparison = await service.compareVersions("rule-1", 1, 2);
      expect(comparison).toBeNull();
    });
  });
});
