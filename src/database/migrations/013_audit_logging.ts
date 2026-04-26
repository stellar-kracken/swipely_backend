import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("audit_logs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("action").notNullable();
    table.string("actor_id").notNullable();
    table.string("actor_type").notNullable().defaultTo("user");
    table.string("ip_address").nullable();
    table.text("user_agent").nullable();
    table.string("resource_type").nullable();
    table.string("resource_id").nullable();
    table.jsonb("before").nullable();
    table.jsonb("after").nullable();
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.string("severity").notNullable().defaultTo("info");
    table.string("checksum", 64).notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["actor_id"]);
    table.index(["action"]);
    table.index(["resource_type", "resource_id"]);
    table.index(["severity"]);
    table.index(["created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("audit_logs");
}
