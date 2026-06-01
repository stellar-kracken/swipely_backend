import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("provider_allowlist", (table) => {
    table.string("provider_key").primary();
    table.string("display_name").notNullable();
    table.string("category").notNullable().defaultTo("unknown");
    table.boolean("allowed").notNullable().defaultTo(true);
    table.text("reason").nullable();
    table.string("created_by").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.string("updated_by").notNullable();
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["category"]);
    table.index(["allowed"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("provider_allowlist");
}
