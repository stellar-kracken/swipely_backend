import "tsx/cjs";
import type { Knex } from "knex";

export async function runMigrations(db: Knex): Promise<void> {
  await db.migrate.latest({
    directory: "./src/database/migrations",
    extension: "ts",
    // Disable transaction wrapping so a failed TimescaleDB call (e.g.
    // create_hypertable inside a try/catch) cannot abort the entire batch
    // and roll back tables from earlier migrations.
    disableTransactions: true,
  });
}

export async function resetDatabase(db: Knex): Promise<void> {
  await db.raw("DROP SCHEMA IF EXISTS public CASCADE");
  await db.raw("CREATE SCHEMA public");
  await db.raw("GRANT ALL ON SCHEMA public TO public");
  await db.raw("GRANT ALL ON SCHEMA public TO current_user");
  await runMigrations(db);
}

export async function rollbackAll(db: Knex): Promise<void> {
  await db.migrate.rollback(
    {
      directory: "./src/database/migrations",
      extension: "ts",
      disableTransactions: true,
    },
    true
  );
}

export async function truncateTables(db: Knex, tables: string[]): Promise<void> {
  if (tables.length === 0) {
    return;
  }

  const identifiers = tables.map((table) => db.client.wrapIdentifier(table));
  await db.raw(
    `TRUNCATE ${identifiers.join(", ")} RESTART IDENTITY CASCADE`
  );
}

export async function cleanDatabase(db: Knex): Promise<void> {
  await truncateTables(db, [
    "alert_events",
    "alert_rules",
    "health_scores",
    "liquidity_snapshots",
    "prices",
    "verification_results",
    "bridge_volume_stats",
    "bridges",
    "assets",
  ]);
}
