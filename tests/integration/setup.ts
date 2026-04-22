import "tsx/cjs";

process.env.NODE_ENV ||= "test";
process.env.POSTGRES_HOST ||= "localhost";
process.env.POSTGRES_PORT ||= "5432";
process.env.POSTGRES_DB ||= "bridge_watch_test";
process.env.POSTGRES_USER ||= "bridge_watch";
process.env.POSTGRES_PASSWORD ||= "test_password";
process.env.REDIS_HOST ||= "localhost";
process.env.REDIS_PORT ||= "6379";

import { beforeAll, afterAll } from "vitest";
import { getDatabase, closeDatabase } from "../../src/database/connection.js";
import { resetDatabase } from "../helpers/db.js";

beforeAll(async () => {
  const db = getDatabase();
  await resetDatabase(db);
});

afterAll(async () => {
  await closeDatabase();
});
