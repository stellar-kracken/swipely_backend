import type { Knex } from "knex";

async function supportsRetentionPolicies(knex: Knex): Promise<boolean> {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'add_retention_policy'
      ) AS supported
    `
  );

  const row = result.rows?.[0] as { supported?: boolean } | undefined;
  return Boolean(row?.supported);
}

async function hasExistingPolicy(knex: Knex, table: string): Promise<boolean> {
  const relationCheck = await knex.raw(`SELECT to_regclass('timescaledb_information.jobs') AS jobs_view`);
  const relationRow = relationCheck.rows?.[0] as { jobs_view?: string | null } | undefined;

  if (!relationRow?.jobs_view) {
    return false;
  }

  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM timescaledb_information.jobs
        WHERE hypertable_name = ?
          AND proc_name = 'policy_retention'
      ) AS has_policy
    `,
    [table]
  );

  const row = result.rows?.[0] as { has_policy?: boolean } | undefined;
  return Boolean(row?.has_policy);
}

async function safeRemovePolicy(knex: Knex, table: string): Promise<void> {
  if (!(await hasExistingPolicy(knex, table))) {
    return;
  }

  await knex.raw(`SELECT remove_retention_policy(?)`, [table]);
}

async function safeAddPolicy(knex: Knex, table: string): Promise<void> {
  if (await hasExistingPolicy(knex, table)) {
    return;
  }

  await knex.raw(`SELECT add_retention_policy(?, INTERVAL '90 days')`, [table]);
}

/**
 * Retention policies for TimescaleDB hypertables.
 * Raw tick data is kept for 90 days; aggregated data is kept indefinitely.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await supportsRetentionPolicies(knex))) {
    return;
  }

  // Ensure a retention policy exists for each raw time-series hypertable.
  const hypertables = [
    "prices",
    "health_scores",
    "alert_events",
    "verification_results",
    "liquidity_snapshots",
  ];

  for (const table of hypertables) {
    await safeAddPolicy(knex, table);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (!(await supportsRetentionPolicies(knex))) {
    return;
  }

  const hypertables = [
    "prices",
    "health_scores",
    "alert_events",
    "verification_results",
    "liquidity_snapshots",
  ];

  for (const table of hypertables) {
    await safeRemovePolicy(knex, table);
  }
}
