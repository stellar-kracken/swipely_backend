import { readFileSync } from "fs";
import type { ZodError, ZodTypeAny } from "zod";
import {
  fixtureRegistry,
  toRepoRelative,
  type FixtureRegistryEntry,
} from "./registry.js";

export type FindingSeverity = "error" | "warning";

export interface FixtureFinding {
  path: string;
  code: string;
  message: string;
  severity: FindingSeverity;
}

export interface FixtureValidationResult {
  name: string;
  file: string;
  description: string;
  loaded: boolean;
  ok: boolean;
  findings: FixtureFinding[];
}

function formatPath(path: ReadonlyArray<string | number>): string {
  if (path.length === 0) return "(root)";
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc ? `${acc}.${segment}` : segment;
  }, "");
}

function issuesToFindings(error: ZodError): FixtureFinding[] {
  const findings: FixtureFinding[] = [];

  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      const base = formatPath(issue.path);
      for (const key of issue.keys) {
        findings.push({
          path: base === "(root)" ? key : `${base}.${key}`,
          code: issue.code,
          message: `Unexpected property "${key}" is not part of the current API shape`,
          severity: "warning",
        });
      }
      continue;
    }

    findings.push({
      path: formatPath(issue.path),
      code: issue.code,
      message: issue.message,
      severity: "error",
    });
  }

  return findings;
}

export function validateData(data: unknown, schema: ZodTypeAny): FixtureFinding[] {
  const result = schema.safeParse(data);
  if (result.success) return [];
  return issuesToFindings(result.error);
}

export function validateFixture(entry: FixtureRegistryEntry): FixtureValidationResult {
  const file = toRepoRelative(entry.file);
  const base = { name: entry.name, file, description: entry.description };

  let raw: string;
  try {
    raw = readFileSync(entry.file, "utf8");
  } catch (err) {
    return {
      ...base,
      loaded: false,
      ok: false,
      findings: [
        {
          path: "(file)",
          code: "file_unreadable",
          message: `Cannot read fixture file: ${(err as Error).message}`,
          severity: "error",
        },
      ],
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      ...base,
      loaded: false,
      ok: false,
      findings: [
        {
          path: "(file)",
          code: "invalid_json",
          message: `Fixture is not valid JSON: ${(err as Error).message}`,
          severity: "error",
        },
      ],
    };
  }

  const findings = validateData(data, entry.schema);
  const ok = !findings.some((f) => f.severity === "error");
  return { ...base, loaded: true, ok, findings };
}

export function validateAllFixtures(
  entries: FixtureRegistryEntry[] = fixtureRegistry,
): FixtureValidationResult[] {
  return entries.map(validateFixture);
}

export interface ValidationSummary {
  results: FixtureValidationResult[];
  errorCount: number;
  warningCount: number;
  failed: boolean;
}

export function summarise(
  results: FixtureValidationResult[],
  { strict = false }: { strict?: boolean } = {},
): ValidationSummary {
  let errorCount = 0;
  let warningCount = 0;

  for (const result of results) {
    for (const finding of result.findings) {
      if (finding.severity === "error") errorCount += 1;
      else warningCount += 1;
    }
  }

  const failed = errorCount > 0 || (strict && warningCount > 0);
  return { results, errorCount, warningCount, failed };
}
