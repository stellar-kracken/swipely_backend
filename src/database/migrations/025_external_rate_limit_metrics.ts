import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("external_rate_limit_metrics", (table) => {
    table.string("id").primary();
    table.string("provider_key").notNullable();
    table.integer("requests_count").notNullable().defaultTo(0);
    table.integer("throttled_count").notNullable().defaultTo(0);
    table.integer("burst_count").notNullable().defaultTo(0);
    table.integer("limit_remaining").nullable();
    table.integer("limit_total").nullable();
    table.integer("reset_at_epoch").nullable();
    table.boolean("is_throttled").notNullable().defaultTo(false);
    table.jsonb("details").notNullable().defaultTo("{}");
    table.timestamp("recorded_at").notNullable().defaultTo(knex.fn.now());

    table.index(["provider_key", "recorded_at"]);
    table.index(["recorded_at"]);
  });

  await knex.schema.createTable("external_rate_limit_alert_thresholds", (table) => {
    table.string("provider_key").primary();
    table.integer("usage_warning_pct").notNullable().defaultTo(70);
    table.integer("usage_critical_pct").notNullable().defaultTo(90);
    table.integer("burst_warning_count").notNullable().defaultTo(5);
    table.boolean("enabled").notNullable().defaultTo(true);
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("external_rate_limit_alert_thresholds");
  await knex.schema.dropTableIfExists("external_rate_limit_metrics");
}
