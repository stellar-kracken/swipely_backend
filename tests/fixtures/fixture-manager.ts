import type { Knex } from "knex";
import { Fixture } from "./fixture-registry.js";
import { truncateTables } from "../helpers/db.js";
import { fixtures } from "./states/index.js";

const FIXTURE_TABLES = [
  "reserve_commitments",
  "bridge_operators",
  "bridge_transactions",
  "bridges",
  "assets",
];

let _loadedFixture: Fixture | null = null;

/**
 * Load a named fixture into the database.
 * Automatically truncates relevant tables before inserting to ensure a clean slate.
 */
export async function loadFixture(db: Knex, fixture: Fixture): Promise<void> {
  await truncateTables(db, FIXTURE_TABLES);

  const loader = fixtures[fixture];
  if (!loader) {
    throw new Error(`Unknown fixture: "${fixture}". Register it in tests/fixtures/states/index.ts`);
  }

  await loader(db);
  _loadedFixture = fixture;
}

/**
 * Reset fixture state — truncates all fixture-managed tables.
 * Call in afterEach to guarantee a clean slate for the next test.
 */
export async function resetFixture(db: Knex): Promise<void> {
  await truncateTables(db, FIXTURE_TABLES);
  _loadedFixture = null;
}

/** Returns the name of the currently loaded fixture, or null if none. */
export function listLoadedFixtures(): Fixture | null {
  return _loadedFixture;
}
