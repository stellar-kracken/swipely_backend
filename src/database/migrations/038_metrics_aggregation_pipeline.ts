import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("metric_data_points", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("metric_key", 120).notNullable();
    table.decimal("value", 20, 6).notNullable();
    table.jsonb("tags").notNullable().defaultTo("{}");
    table.timestamp("recorded_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(["metric_key", "recorded_at"], "idx_metric_points_key_time");
    table.index(["recorded_at"], "idx_metric_points_recorded_at");
  });

  await knex.schema.createTable("metric_rollups", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("metric_key", 120).notNullable();
    table.string("granularity", 20).notNullable();
    table.timestamp("window_start", { useTz: true }).notNullable();
    table.timestamp("window_end", { useTz: true }).notNullable();
    table.integer("sample_count").notNullable().defaultTo(0);
    table.decimal("sum_value", 24, 6).notNullable().defaultTo(0);
    table.decimal("min_value", 20, 6).notNullable().defaultTo(0);
    table.decimal("max_value", 20, 6).notNullable().defaultTo(0);
    table.decimal("avg_value", 20, 6).notNullable().defaultTo(0);
    table.decimal("p50_value", 20, 6).notNullable().defaultTo(0);
    table.decimal("p95_value", 20, 6).notNullable().defaultTo(0);
    table.decimal("p99_value", 20, 6).notNullable().defaultTo(0);
    table.jsonb("tags").notNullable().defaultTo("{}");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(["metric_key", "granularity", "window_start"], { indexName: "uniq_metric_rollup_window" });
    table.index(["metric_key", "granularity", "window_start"], "idx_metric_rollups_query");
    table.index(["granularity", "window_start"], "idx_metric_rollups_granularity_time");
  });

  await knex.schema.createTable("metric_retention_policies", (table) => {
    table.string("granularity", 20).primary();
    table.integer("retention_days").notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex("metric_retention_policies")
    .insert([
      { granularity: "raw", retention_days: 7 },
      { granularity: "hourly", retention_days: 90 },
      { granularity: "daily", retention_days: 365 },
      { granularity: "weekly", retention_days: 1825 },
    ])
    .onConflict("granularity")
    .ignore();
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("metric_retention_policies");
  await knex.schema.dropTableIfExists("metric_rollups");
  await knex.schema.dropTableIfExists("metric_data_points");
}
