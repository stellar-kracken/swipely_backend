import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("user_saved_metrics", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table.text("description");
    table.text("formula").notNullable();
    table.boolean("is_shared").notNullable().defaultTo(false);
    table.uuid("created_by").notNullable();
    table.integer("cache_ttl").notNullable().defaultTo(600);
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["created_by"]);
    table.index(["is_shared"]);
    table.unique(["created_by", "name"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("user_saved_metrics");
}
