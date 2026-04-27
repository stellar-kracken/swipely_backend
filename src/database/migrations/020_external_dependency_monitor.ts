import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("external_dependencies", (table) => {
    table.string("provider_key").primary();
    table.string("display_name").notNullable();
    table.string("category").notNullable();
    table.string("endpoint").notNullable();
    table.string("check_type").notNullable().defaultTo("http");
    table.integer("latency_warning_ms").notNullable().defaultTo(1_000);
    table.integer("latency_critical_ms").notNullable().defaultTo(3_000);
    table.integer("failure_threshold").notNullable().defaultTo(3);
    table.boolean("maintenance_mode").notNullable().defaultTo(false);
    table.text("maintenance_note").nullable();
    table.string("status").notNullable().defaultTo("unknown");
    table.timestamp("last_checked_at").nullable();
    table.integer("last_latency_ms").nullable();
    table.integer("consecutive_failures").notNullable().defaultTo(0);
    table.timestamp("last_success_at").nullable();
    table.timestamp("last_failure_at").nullable();
    table.text("last_error").nullable();
    table.timestamps(true, true);

    table.index(["category"]);
    table.index(["status"]);
    table.index(["maintenance_mode"]);
  });

  await knex.schema.createTable("external_dependency_checks", (table) => {
    table.timestamp("checked_at").notNullable().defaultTo(knex.fn.now());
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("provider_key").notNullable();
    table.string("status").notNullable();
    table.integer("latency_ms").nullable();
    table.integer("status_code").nullable();
    table.boolean("within_threshold").notNullable().defaultTo(false);
    table.boolean("alert_triggered").notNullable().defaultTo(false);
    table.text("error").nullable();
    table.jsonb("details").notNullable().defaultTo("{}");

    table.index(["provider_key", "checked_at"]);
    table.index(["status", "checked_at"]);
    table.index(["alert_triggered"]);
  });

  try {
    await knex.raw(
      "SELECT create_hypertable('external_dependency_checks', 'checked_at', if_not_exists => TRUE)"
    );
  } catch {
    // Running without TimescaleDB is acceptable in local/test environments.
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("external_dependency_checks");
  await knex.schema.dropTableIfExists("external_dependencies");
}
