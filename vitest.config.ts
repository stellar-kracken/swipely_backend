import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        lines: 60,
        functions: 55,
        branches: 35,
        statements: 60,
      },
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/{api,services,workers,jobs}/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          pool: "forks",
          poolOptions: {
            forks: { singleFork: true },
          },
          testTimeout: 30000,
        },
      },
    ],
  },
});
