import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("usage_metrics", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("endpoint").notNullable();
    table.string("method").notNullable();
    table.integer("status_code").notNullable();
    table.integer("duration_ms").notNullable();
    table.string("user_id").nullable();
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["endpoint", "created_at"]);
    table.index(["user_id", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("usage_metrics");
}
