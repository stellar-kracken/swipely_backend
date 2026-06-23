import type { FixtureValidationResult, ValidationSummary } from "./validator.js";

const SYMBOLS = {
  pass: "✓",
  fail: "✗",
  warn: "!",
};

function formatResult(result: FixtureValidationResult): string {
  const lines: string[] = [];
  const status = result.ok ? SYMBOLS.pass : SYMBOLS.fail;
  lines.push(`${status} ${result.name}  (${result.file})`);
  lines.push(`    ${result.description}`);

  for (const finding of result.findings) {
    const marker = finding.severity === "error" ? SYMBOLS.fail : SYMBOLS.warn;
    const label = finding.severity.toUpperCase();
    lines.push(`    ${marker} ${label} at ${finding.path}: ${finding.message}`);
  }

  return lines.join("\n");
}

export function formatReport(summary: ValidationSummary): string {
  const sections = summary.results.map(formatResult);
  const total = summary.results.length;
  const failedFixtures = summary.results.filter((r) => !r.ok).length;

  const footer = [
    "",
    `Fixtures checked: ${total}  |  ` +
      `passed: ${total - failedFixtures}  |  ` +
      `with errors: ${failedFixtures}`,
    `Findings: ${summary.errorCount} error(s), ${summary.warningCount} warning(s)`,
    summary.failed
      ? "Result: FAIL — fixtures have drifted from the current API shapes."
      : "Result: PASS — all fixtures match the current API shapes.",
  ];

  return [...sections, ...footer].join("\n");
}
