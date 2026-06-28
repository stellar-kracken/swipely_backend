import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NotificationTemplateService,
  type NotificationTemplate,
} from "../../src/services/notificationTemplate.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const dbMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => dbMock,
}));

type StoredRow = Record<string, any>;

const tables = vi.hoisted(() => ({
  notification_templates: [] as StoredRow[],
  template_versions: [] as StoredRow[],
}));

function resetTables() {
  tables.notification_templates.length = 0;
  tables.template_versions.length = 0;
}

function createQuery(table: keyof typeof tables) {
  let rows = tables[table];
  const query = {
    where: vi.fn((criteriaOrColumn: any, value?: any) => {
      if (typeof criteriaOrColumn === "string") {
        rows = rows.filter((row) => row[criteriaOrColumn] === value);
      } else {
        rows = rows.filter((row) =>
          Object.entries(criteriaOrColumn).every(([key, expected]) => row[key] === expected),
        );
      }
      return query;
    }),
    first: vi.fn(async () => rows[0] ?? null),
    insert: vi.fn(async (row: StoredRow) => {
      tables[table].push(row);
      return [row.id];
    }),
    update: vi.fn(async (updates: StoredRow) => {
      for (const row of rows) {
        Object.assign(row, updates);
      }
      return rows.length;
    }),
    orderBy: vi.fn(async (column: string, direction: "asc" | "desc" = "asc") => {
      const sorted = [...rows].sort((a, b) => {
        const left = a[column] instanceof Date ? a[column].getTime() : a[column];
        const right = b[column] instanceof Date ? b[column].getTime() : b[column];
        return direction === "desc" ? right - left : left - right;
      });
      return sorted;
    }),
  };
  return query;
}

function seedTemplate(overrides: Partial<NotificationTemplate> = {}) {
  const template = {
    id: "template-1",
    name: "Bridge alert",
    description: "Bridge alert template",
    channel: "email",
    subject: "Alert for {{asset}}",
    body: "Hello {{user}}, {{asset}} is {{status}}.",
    variables: JSON.stringify(["asset", "user", "status"]),
    metadata: JSON.stringify({ severity: "high" }),
    status: "approved",
    version: 1,
    created_by: "ops",
    approved_by: "lead",
    approved_at: new Date("2026-01-01T00:00:00.000Z"),
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
  tables.notification_templates.push(template);
  return template;
}

describe("NotificationTemplateService", () => {
  let service: NotificationTemplateService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetTables();
    dbMock.mockImplementation((table: keyof typeof tables) => createQuery(table));
    service = new NotificationTemplateService();
  });

  it("creates templates with extracted unique variables and an initial version", async () => {
    const template = await service.createTemplate({
      name: "Depeg email",
      description: "Depeg alert email",
      channel: "email",
      subject: "{{asset}} depeg alert",
      body: "{{asset}} moved to {{price}} for {{asset}}",
      variables: [],
      metadata: { severity: "critical" },
      created_by: "ops",
    });

    expect(template).toMatchObject({
      name: "Depeg email",
      channel: "email",
      status: "draft",
      version: 1,
      variables: ["asset", "price"],
      metadata: { severity: "critical" },
    });
    expect(tables.notification_templates).toHaveLength(1);
    expect(tables.template_versions).toHaveLength(1);
    expect(JSON.parse(tables.template_versions[0].variables)).toEqual(["asset", "price", "asset", "asset"]);
  });

  it("renders previews and reports missing variables without replacing unresolved tokens", async () => {
    seedTemplate();

    const preview = await service.previewTemplate("template-1", {
      asset: "USDC",
      user: "Mira",
    });

    expect(preview).toEqual({
      subject: "Alert for USDC",
      body: "Hello Mira, USDC is {{status}}.",
      variables_used: ["asset", "user", "status"],
      missing_variables: ["status"],
    });
  });

  it("validates required and unused variables across body and subject", () => {
    expect(
      service.validateVariables(
        "{{asset}} crossed {{threshold}}",
        "Alert: {{asset}}",
        ["asset", "channel"],
      ),
    ).toEqual({
      valid: false,
      missing: ["threshold"],
      unused: ["channel"],
    });
  });

  it("filters templates by channel and status variants", async () => {
    seedTemplate({ id: "email-1", channel: "email", status: "approved" });
    seedTemplate({ id: "webhook-1", channel: "webhook", status: "draft" });
    seedTemplate({ id: "in-app-1", channel: "in_app", status: "approved" });
    seedTemplate({ id: "sms-1", channel: "sms", status: "archived" });

    await expect(service.getAllTemplates({ channel: "webhook" })).resolves.toEqual([
      expect.objectContaining({ id: "webhook-1", channel: "webhook" }),
    ]);
    await expect(service.getAllTemplates({ status: "approved" })).resolves.toEqual([
      expect.objectContaining({ id: "email-1", channel: "email" }),
      expect.objectContaining({ id: "in-app-1", channel: "in_app" }),
    ]);
  });

  it("updates status for approval flow and creates a version on content updates", async () => {
    seedTemplate({ status: "draft", approved_by: null, approved_at: null });

    await service.submitForApproval("template-1");
    expect(tables.notification_templates[0].status).toBe("pending_approval");

    await service.approveTemplate("template-1", "approver-1");
    expect(tables.notification_templates[0]).toMatchObject({
      status: "approved",
      approved_by: "approver-1",
    });

    const updated = await service.updateTemplate(
      "template-1",
      { body: "Updated {{asset}} {{status}} {{severity}}" },
      "editor-1",
    );

    expect(updated).toMatchObject({
      version: 2,
      status: "draft",
      variables: ["asset", "user", "status", "severity"],
    });
    expect(tables.template_versions).toHaveLength(1);
    expect(tables.template_versions[0]).toMatchObject({ template_id: "template-1", version: 2 });
  });

  it("throws when previewing an unknown template", async () => {
    await expect(service.previewTemplate("missing", {})).rejects.toThrow("Template not found");
  });
});
