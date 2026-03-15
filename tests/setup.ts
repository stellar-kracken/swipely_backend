import { beforeAll, afterAll } from "vitest";

// Global test setup
beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.POSTGRES_HOST = "localhost";
  process.env.POSTGRES_PORT = "5432";
  process.env.POSTGRES_DB = "bridge_watch_test";
  process.env.POSTGRES_USER = "bridge_watch";
  process.env.POSTGRES_PASSWORD = "test_password";
  process.env.REDIS_HOST = "localhost";
  process.env.REDIS_PORT = "6379";
});

afterAll(async () => {
  // Cleanup resources
});
