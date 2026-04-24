import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Dedicated history table with TimescaleDB hypertable support
  await knex.schema.createTable("health_score_history", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("symbol").notNullable();
    table.integer("overall_score").notNullable();
    table.integer("liquidity_depth_score").notNullable().defaultTo(0);
    table.integer("price_stability_score").notNullable().defaultTo(0);
    table.integer("bridge_uptime_score").notNullable().defaultTo(0);
    table.integer("reserve_backing_score").notNullable().defaultTo(0);
    table.integer("volume_trend_score").notNullable().defaultTo(0);
    table.string("trend").notNullable().defaultTo("stable"); // improving | stable | deteriorating
    table.integer("delta").nullable(); // diff from previous snapshot
    table.string("source").notNullable().defaultTo("scheduled"); // scheduled | manual | backfill
    table.timestamp("recorded_at").notNullable().defaultTo(knex.fn.now());

    table.index(["symbol", "recorded_at"]);
    table.index(["recorded_at"]);
  });

  // Try to convert to TimescaleDB hypertable (only available when extension is present)
  try {
    await knex.raw(
      `SELECT create_hypertable('health_score_history', 'recorded_at', if_not_exists => TRUE)`
    );
  } catch {
    // TimescaleDB extension not available — plain table is fine
  }

  // Retention policy configuration table
  await knex.schema.createTable("health_score_retention_policies", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("symbol").notNullable().unique();
    table.integer("retain_days").notNullable().defaultTo(90);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("health_score_retention_policies");
  await knex.schema.dropTableIfExists("health_score_history");
}
