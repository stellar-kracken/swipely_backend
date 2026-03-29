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

async function safeRemovePolicy(knex: Knex, table: string): Promise<void> {
  try {
    await knex.raw(`SELECT remove_retention_policy(?)`, [table]);
  } catch {
    // Ignore when no policy exists or when optional args are unsupported.
  }
}

async function safeAddPolicy(knex: Knex, table: string): Promise<void> {
  try {
    await knex.raw(`SELECT add_retention_policy(?, INTERVAL '90 days')`, [table]);
  } catch {
    // Ignore when policy already exists or extension variants differ.
  }
}

/**
 * Retention policies for TimescaleDB hypertables.
 * Raw tick data is kept for 90 days; aggregated data is kept indefinitely.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await supportsRetentionPolicies(knex))) {
    return;
  }

  // Drop old policies first (idempotent)
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

  // 90-day retention on raw time-series tables
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
