import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDbFirst = vi.fn();
const mockDb = vi.fn(() => ({
  where: vi.fn().mockReturnThis(),
  first: mockDbFirst,
}));

vi.mock("../../database/connection.js", () => ({
  getDatabase: () => mockDb,
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("telegraf", () => ({
  Telegraf: vi.fn().mockImplementation(() => ({
    use: vi.fn(),
    command: vi.fn(),
    on: vi.fn(),
    action: vi.fn(),
    launch: vi.fn(),
    stop: vi.fn(),
    telegram: { setWebhook: vi.fn(), deleteWebhook: vi.fn() },
  })),
  Markup: { inlineKeyboard: vi.fn(() => ({})), button: { callback: vi.fn() } },
  Context: class {},
}));

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  })),
}));

vi.mock("../formatters/telegram.formatter.js", () => ({
  formatAlertMessage: vi.fn(() => "msg"),
  escapeTelegramMarkdown: vi.fn((s: string) => s),
}));

vi.mock("../../config/index.js", () => ({
  config: {
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_BOT_ENABLED: true,
    TELEGRAM_ADMIN_CHAT_IDS: "9999",
    TELEGRAM_WEBHOOK_URL: "",
    REDIS_HOST: "localhost",
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
    TELEGRAM_RATE_LIMIT_OUTBOUND_GLOBAL_PER_SEC: 10,
    TELEGRAM_RATE_LIMIT_OUTBOUND_PER_CHAT_PER_SEC: 1,
  },
}));

import { TelegramBotService } from "../telegram.bot.service.js";

describe("TelegramBotService.isAdminChat", () => {
  let svc: TelegramBotService;
  let isAdminChat: (chatId: string, userId?: string) => Promise<boolean>;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new TelegramBotService();
    isAdminChat = (svc as any).isAdminChat.bind(svc);
  });

  it("grants access to bootstrap admin chat IDs", async () => {
    mockDbFirst.mockResolvedValue(null);
    expect(await isAdminChat("9999")).toBe(true);
  });

  it("grants access when admin_accounts row has operator role", async () => {
    mockDbFirst.mockResolvedValue({ roles: JSON.stringify(["operator"]), is_active: true });
    expect(await isAdminChat("1234")).toBe(true);
  });

  it("grants access when admin_accounts row has super_admin role", async () => {
    mockDbFirst.mockResolvedValue({ roles: ["super_admin"], is_active: true });
    expect(await isAdminChat("5678")).toBe(true);
  });

  it("denies access when admin_accounts row has only auditor role", async () => {
    mockDbFirst.mockResolvedValue({ roles: JSON.stringify(["auditor"]), is_active: true });
    expect(await isAdminChat("1111")).toBe(false);
  });

  it("denies access when no matching admin_accounts row", async () => {
    mockDbFirst.mockResolvedValue(null);
    expect(await isAdminChat("0000")).toBe(false);
  });

  it("denies access and does not throw when db query fails", async () => {
    mockDbFirst.mockRejectedValue(new Error("db error"));
    await expect(isAdminChat("2222")).resolves.toBe(false);
  });
});
