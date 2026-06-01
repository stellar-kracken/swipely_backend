import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("feature_flag_audit_logs", (table) => {
    table.string("id").primary();
    table.string("flag_name").notNullable();
    table.string("environment").notNullable().defaultTo("default");
    table.enum("action", ["create", "update", "delete"]).notNullable();
    table.text("old_value");
    table.text("new_value");
    table.string("changed_by").notNullable();
    table.text("change_reason");
    table.timestamp("timestamp").notNullable().defaultTo(knex.fn.now());

    table.index(["flag_name"]);
    table.index(["environment"]);
    table.index(["changed_by"]);
    table.index(["timestamp"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("feature_flag_audit_logs");
}
