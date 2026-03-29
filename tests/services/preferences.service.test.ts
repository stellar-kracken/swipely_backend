import { describe, it, expect, vi } from "vitest";
import { PreferencesService } from "../../src/services/preferences.service.js";

describe("PreferencesService", () => {
  it("validates supported keys and values", () => {
    const service = new PreferencesService();

    expect(() =>
      (service as unknown as { validateSinglePreference: Function }).validateSinglePreference(
        "display",
        "theme",
        "dark"
      )
    ).not.toThrow();

    expect(() =>
      (service as unknown as { validateSinglePreference: Function }).validateSinglePreference(
        "display",
        "currency",
        "usd"
      )
    ).toThrow();
  });

  it("migrates legacy schema v1 import payload to v2", async () => {
    const service = new PreferencesService();
    vi.spyOn(
      service as unknown as { recordMigrationHistory: Function },
      "recordMigrationHistory"
    ).mockResolvedValue(undefined);

    const payload = {
      notifications: {
        pushNotifications: false,
      },
      display: {
        useCompactMode: true,
      },
      alerts: {
        severity: "high",
      },
    };

    const migrated = await (
      service as unknown as {
        applyImportMigrations: (
          userId: string,
          version: number,
          categories: Record<string, Record<string, unknown>>
        ) => Promise<Record<string, Record<string, unknown>>>;
      }
    ).applyImportMigrations("user-1", 1, payload as Record<string, Record<string, unknown>>);

    expect(migrated.notifications.pushEnabled).toBe(false);
    expect(migrated.display.compactMode).toBe(true);
    expect(migrated.alerts.defaultSeverity).toBe("high");
  });
});
