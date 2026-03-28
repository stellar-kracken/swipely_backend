import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/index.js";

const mockedService = {
  getPreferences: vi.fn().mockResolvedValue({
    userId: "user-1",
    version: 1,
    schemaVersion: 2,
    lastUpdatedAt: new Date().toISOString(),
    categories: {
      notifications: {
        emailEnabled: true,
        pushEnabled: true,
        digestFrequency: "daily",
      },
      display: {
        theme: "system",
        compactMode: false,
        timezone: "UTC",
        currency: "USD",
      },
      alerts: {
        defaultSeverity: "medium",
        channels: ["in_app"],
        mutedAssets: [],
      },
    },
  }),
  getPreference: vi.fn().mockResolvedValue(true),
  setPreference: vi.fn().mockResolvedValue({ ok: true }),
  bulkUpdatePreferences: vi.fn().mockResolvedValue({ ok: true }),
  resetPreference: vi.fn().mockResolvedValue({ ok: true }),
  exportPreferences: vi.fn().mockResolvedValue({ schemaVersion: 2, categories: {} }),
  importPreferences: vi.fn().mockResolvedValue({ ok: true }),
  onPreferencesUpdated: vi.fn(() => () => undefined),
};

vi.mock("../../src/services/preferences.service.js", () => {
  return {
    PreferencesService: class PreferencesService {
      getPreferences = mockedService.getPreferences;
      getPreference = mockedService.getPreference;
      setPreference = mockedService.setPreference;
      bulkUpdatePreferences = mockedService.bulkUpdatePreferences;
      resetPreference = mockedService.resetPreference;
      exportPreferences = mockedService.exportPreferences;
      importPreferences = mockedService.importPreferences;
      onPreferencesUpdated = mockedService.onPreferencesUpdated;
    },
  };
});

describe("Preferences API", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("GET /api/v1/preferences/:userId returns effective preferences", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/preferences/user-1",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty("preferences");
    expect(body.preferences.userId).toBe("user-1");
  });

  it("PUT /api/v1/preferences/:userId/:category/:key rejects invalid category", async () => {
    const response = await server.inject({
      method: "PUT",
      url: "/api/v1/preferences/user-1/invalid/theme",
      payload: {
        value: "dark",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("PATCH /api/v1/preferences/:userId/bulk returns conflict on version mismatch", async () => {
    mockedService.bulkUpdatePreferences.mockRejectedValueOnce(
      new Error("Version conflict: expected 1, current 2")
    );

    const response = await server.inject({
      method: "PATCH",
      url: "/api/v1/preferences/user-1/bulk",
      payload: {
        expectedVersion: 1,
        updates: {
          display: {
            theme: "dark",
          },
        },
      },
    });

    expect(response.statusCode).toBe(409);
  });
});
