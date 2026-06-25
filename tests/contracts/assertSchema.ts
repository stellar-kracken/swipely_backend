import type { z } from "zod";
import { expect } from "vitest";

/**
 * Asserts that `body` matches `schema`, formatting Zod issues into a
 * readable, per-field breaking-change report instead of a raw ZodError dump.
 *
 * Use this for every schema contract test so failures clearly say which
 * field broke the contract and why, e.g.:
 *
 *   Schema contract violation for "GET /health":
 *     - uptime: Expected number, received string
 *     - version: Required
 */
export function assertMatchesSchema<T>(
  endpoint: string,
  body: unknown,
  schema: z.ZodType<T>
): T {
  const result = schema.safeParse(body);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Schema contract violation for "${endpoint}":\n${issues}\n\n` +
        `This means the response shape changed in a way that breaks the documented ` +
        `API contract. If this change is intentional, update the schema in ` +
        `tests/contracts/schemas.ts and call this out as a breaking change in the PR.`
    );
  }

  expect(result.success).toBe(true);
  return result.data;
}
