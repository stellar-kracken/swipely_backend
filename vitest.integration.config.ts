import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/integration/setup.ts"],
    include: [
      "tests/integration/**/*.test.ts",
      "tests/api/smoke.test.ts",
      "tests/api/analytics.test.ts",
      "tests/api/circuitBreaker.test.ts",
      "tests/api/exports.test.ts",
    ],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 30000,
  },
});
