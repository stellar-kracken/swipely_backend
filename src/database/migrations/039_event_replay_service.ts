import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("event_replay_runs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("requested_by", 120).notNullable();
    table.jsonb("filter").notNullable().defaultTo("{}");
    table.boolean("dry_run").notNullable().defaultTo(true);
    table.string("reason", 500).nullable();
    table.string("status", 20).notNullable().defaultTo("pending");
    table.integer("total_matched").notNullable().defaultTo(0);
    table.integer("total_replayed").notNullable().defaultTo(0);
    table.integer("total_skipped").notNullable().defaultTo(0);
    table.text("error_message").nullable();
    table.timestamp("started_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("completed_at", { useTz: true }).nullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(["status"], "idx_event_replay_runs_status");
    table.index(["created_at"], "idx_event_replay_runs_created_at");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("event_replay_runs");
}
