/**
 * Generates backend/docs/openapi.json and backend/docs/openapi.yaml
 * from the live Fastify route schemas.
 *
 * Usage: npx tsx scripts/generate-openapi.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Match the test suite's convention (tests/setup.ts) for importing src/index.js
// as a module: NODE_ENV=test both selects the silent logger config (the
// development transport can't cross the pino-pretty worker-thread boundary)
// and skips the file's own `if (NODE_ENV !== "test") start()` auto-listen,
// so generating the spec never binds a port or touches a real DB/Redis.
process.env.NODE_ENV = "test";

async function main() {
  const { buildServer } = await import("../src/index.js");

  const server = await buildServer();
  await server.ready();

  const spec = server.swagger();

  const docsDir = join(__dirname, "..", "docs");
  mkdirSync(docsDir, { recursive: true });

  const jsonPath = join(docsDir, "openapi.json");
  writeFileSync(jsonPath, JSON.stringify(spec, null, 2));
  console.log(`✓ Wrote ${jsonPath}`);

  // Write YAML — convert via simple serialization
  const { default: yaml } = await import("js-yaml").catch(() => {
    console.warn("js-yaml not installed, skipping .yaml output");
    return { default: null };
  });

  if (yaml) {
    const yamlPath = join(docsDir, "openapi.yaml");
    writeFileSync(yamlPath, yaml.dump(spec, { lineWidth: 120 }));
    console.log(`✓ Wrote ${yamlPath}`);
  }

  await server.close();

  // Building the server wires up module-level clients (Redis, etc.) that keep
  // retrying/reconnecting in the background even when nothing in this script
  // is using them; those pending timers would otherwise keep the process
  // alive indefinitely after our actual work is done. Exit explicitly now
  // that the spec has been written and the server has been closed.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
