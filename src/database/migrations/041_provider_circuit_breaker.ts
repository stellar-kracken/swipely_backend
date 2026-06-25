import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("provider_circuit_breaker_state", (table) => {
    table.string("provider_key", 120).primary();
    table.string("state", 20).notNullable().defaultTo("closed");
    table.integer("consecutive_failures").notNullable().defaultTo(0);
    table.integer("failure_threshold").notNullable().defaultTo(5);
    table.integer("recovery_timeout_ms").notNullable().defaultTo(60_000);
    table.integer("trip_count").notNullable().defaultTo(0);
    table.string("fallback_provider_key", 120).nullable();
    table.string("manual_override", 20).nullable();
    table.timestamp("opened_at", { useTz: true }).nullable();
    table.timestamp("half_opened_at", { useTz: true }).nullable();
    table.timestamp("last_failure_at", { useTz: true }).nullable();
    table.timestamp("last_success_at", { useTz: true }).nullable();
    table.timestamps(true, true);
    table.index(["state"], "idx_provider_breaker_state");
  });

  await knex.schema.createTable("provider_circuit_breaker_transitions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("provider_key", 120).notNullable();
    table.string("from_state", 20).notNullable();
    table.string("to_state", 20).notNullable();
    table.string("reason", 255).notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(["provider_key", "created_at"], "idx_provider_breaker_transitions_key_time");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("provider_circuit_breaker_transitions");
  await knex.schema.dropTableIfExists("provider_circuit_breaker_state");
}
