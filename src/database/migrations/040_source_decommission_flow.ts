import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("source_decommissions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("source_key", 120).notNullable().unique();
    table.string("replacement_source_key", 120).notNullable();
    table.string("status", 20).notNullable().defaultTo("deprecated");
    table.integer("deprecation_period_days").notNullable().defaultTo(30);
    table.timestamp("deprecation_started_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("deprecation_ends_at", { useTz: true }).notNullable();
    table.boolean("fallback_routing_enabled").notNullable().defaultTo(true);
    table.decimal("migration_progress_pct", 5, 2).notNullable().defaultTo(0);
    table.boolean("completion_ready").notNullable().defaultTo(false);
    table.timestamp("completion_verified_at", { useTz: true }).nullable();
    table.string("created_by", 120).notNullable();
    table.text("reason").nullable();
    table.timestamps(true, true);
    table.index(["status"], "idx_source_decommissions_status");
    table.index(["deprecation_ends_at"], "idx_source_decommissions_ends_at");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("source_decommissions");
}
