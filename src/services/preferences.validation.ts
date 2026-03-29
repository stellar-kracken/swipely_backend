import { z } from "zod";

export const preferenceCategories = ["notifications", "display", "alerts"] as const;
export type PreferenceCategory = (typeof preferenceCategories)[number];

export const categorySchema = z.enum(preferenceCategories);

export const categoryPreferenceSchemas = {
  notifications: {
    emailEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    digestFrequency: z.enum(["never", "daily", "weekly"]),
  },
  display: {
    theme: z.enum(["light", "dark", "system"]),
    compactMode: z.boolean(),
    timezone: z.string().min(1).max(64),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO code"),
  },
  alerts: {
    defaultSeverity: z.enum(["low", "medium", "high", "critical"]),
    channels: z.array(z.enum(["in_app", "email", "webhook"])).max(10),
    mutedAssets: z.array(z.string().min(1).max(24)).max(100),
  },
} as const;

export type PreferenceDefaults = {
  notifications: {
    emailEnabled: boolean;
    pushEnabled: boolean;
    digestFrequency: "never" | "daily" | "weekly";
  };
  display: {
    theme: "light" | "dark" | "system";
    compactMode: boolean;
    timezone: string;
    currency: string;
  };
  alerts: {
    defaultSeverity: "low" | "medium" | "high" | "critical";
    channels: Array<"in_app" | "email" | "webhook">;
    mutedAssets: string[];
  };
};

export const DEFAULT_PREFERENCES: PreferenceDefaults = {
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
};

export const singlePreferenceUpdateSchema = z.object({
  value: z.unknown(),
});

export const bulkPreferenceUpdateSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  updates: z
    .object({
      notifications: z.record(z.string(), z.unknown()).optional(),
      display: z.record(z.string(), z.unknown()).optional(),
      alerts: z.record(z.string(), z.unknown()).optional(),
    })
    .refine(
      (value) =>
        Object.values(value).some(
          (item) => item !== undefined && Object.keys(item).length > 0
        ),
      { message: "At least one update entry is required" }
    ),
});

export const importPreferencesSchema = z.object({
  overwrite: z.boolean().default(true),
  data: z.object({
    schemaVersion: z.number().int().positive(),
    version: z.number().int().positive().optional(),
    exportedAt: z.string().datetime().optional(),
    categories: z.record(z.string(), z.record(z.string(), z.unknown())),
  }),
});
