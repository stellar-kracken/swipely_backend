import {
  formatReport,
  summarise,
  validateAllFixtures,
} from "../src/testing/fixtureValidator/index.js";

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const strict = args.includes("--strict");

  const results = validateAllFixtures();
  const summary = summarise(results, { strict });

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatReport(summary));
  }

  process.exit(summary.failed ? 1 : 0);
}

main();
