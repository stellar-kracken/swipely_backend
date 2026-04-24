import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditService, type AuditAction } from "../../src/services/audit.service.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/database/connection.js", () => {
  const makeBuilder = (returnRows: unknown[] = []) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.where = vi.fn().mockReturnValue(b);
    b.clone = vi.fn().mockReturnValue(b);
    b.select = vi.fn().mockReturnValue(b);
    b.count = vi.fn().mockReturnValue(b);
    b.groupBy = vi.fn().mockReturnValue(b);
    b.orderBy = vi.fn().mockReturnValue(b);
    b.limit = vi.fn().mockResolvedValue(returnRows);
    b.offset = vi.fn().mockReturnValue(b);
    b.first = vi.fn().mockResolvedValue(returnRows[0] ?? null);
    b.insert = vi.fn().mockReturnValue(b);
    b.update = vi.fn().mockResolvedValue(1);
    b.delete = vi.fn().mockResolvedValue(2);
    b.returning = vi.fn().mockResolvedValue(returnRows);
    return b;
  };

  return {
    getDatabase: vi.fn(() => {
      const fn = (_table: string) => makeBuilder();
      fn.raw = vi.fn((v: string) => v);
      fn.fn = { now: () => new Date() };
      return fn;
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "audit-1",
    action: "auth.login",
    actor_id: "user-123",
    actor_type: "user",
    ip_address: "127.0.0.1",
    user_agent: "Mozilla/5.0",
    resource_type: null,
    resource_id: null,
    before: null,
    after: null,
    metadata: "{}",
    severity: "info",
    checksum: "",
    created_at: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditService — checksum / tamper detection", () => {
  let service: AuditService;

  beforeEach(() => {
    (AuditService as any).instance = undefined;
    service = AuditService.getInstance();
  });

  it("computeChecksum is deterministic for same inputs", () => {
    const entry = {
      action: "auth.login" as AuditAction,
      actorId: "user-1",
      actorType: "user" as const,
      ipAddress: "1.2.3.4",
      userAgent: null,
      resourceType: null,
      resourceId: null,
      before: null,
      after: null,
      metadata: {},
      severity: "info" as const,
    };
    const c1 = (service as any).computeChecksum(entry);
    const c2 = (service as any).computeChecksum(entry);
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyChecksum returns false when checksum is tampered", () => {
    const entry = {
      action: "auth.login" as AuditAction,
      actorId: "user-1",
      actorType: "user" as const,
      ipAddress: null,
      userAgent: null,
      resourceType: null,
      resourceId: null,
      before: null,
      after: null,
      metadata: {},
      severity: "info" as const,
    };
    const realChecksum = (service as any).computeChecksum(entry);
    const auditEntry = { id: "x", createdAt: new Date(), ...entry, checksum: realChecksum };

    expect(service.verifyChecksum(auditEntry)).toBe(true);

    // Tamper with actor
    auditEntry.actorId = "attacker";
    expect(service.verifyChecksum(auditEntry)).toBe(false);
  });
});

describe("AuditService — severity inference", () => {
  let service: AuditService;

  beforeEach(() => {
    (AuditService as any).instance = undefined;
    service = AuditService.getInstance();
  });

  it("maps admin.retention_policy_changed to critical", () => {
    expect((service as any).inferSeverity("admin.retention_policy_changed")).toBe("critical");
  });

  it("maps admin.config_changed to warning", () => {
    expect((service as any).inferSeverity("admin.config_changed")).toBe("warning");
  });

  it("maps auth.login to info", () => {
    expect((service as any).inferSeverity("auth.login")).toBe("info");
  });

  it("maps webhook.secret_rotated to warning", () => {
    expect((service as any).inferSeverity("webhook.secret_rotated")).toBe("warning");
  });
});

describe("AuditService — mapRow", () => {
  let service: AuditService;

  beforeEach(() => {
    (AuditService as any).instance = undefined;
    service = AuditService.getInstance();
  });

  it("parses JSON string fields", () => {
    const row = makeRow({
      before: JSON.stringify({ price: 1.0 }),
      after: JSON.stringify({ price: 1.1 }),
      metadata: JSON.stringify({ source: "api" }),
    });
    const entry = (service as any).mapRow(row);
    expect(entry.before).toEqual({ price: 1.0 });
    expect(entry.after).toEqual({ price: 1.1 });
    expect(entry.metadata).toEqual({ source: "api" });
  });

  it("handles already-parsed JSONB objects", () => {
    const row = makeRow({ metadata: { source: "worker" } });
    const entry = (service as any).mapRow(row);
    expect(entry.metadata).toEqual({ source: "worker" });
  });

  it("maps null JSON fields to null", () => {
    const row = makeRow({ before: null, after: null });
    const entry = (service as any).mapRow(row);
    expect(entry.before).toBeNull();
    expect(entry.after).toBeNull();
  });
});

describe("AuditService — exportCsv", () => {
  it("produces a CSV string with header row", async () => {
    (AuditService as any).instance = undefined;
    const service = AuditService.getInstance();

    vi.spyOn(service, "query").mockResolvedValue({ entries: [], total: 0 });
    const csv = await service.exportCsv();
    expect(csv.startsWith("id,action,actor_id")).toBe(true);
  });
});

describe("AuditService — singleton", () => {
  it("getInstance returns the same instance", () => {
    (AuditService as any).instance = undefined;
    const a = AuditService.getInstance();
    const b = AuditService.getInstance();
    expect(a).toBe(b);
  });
});
