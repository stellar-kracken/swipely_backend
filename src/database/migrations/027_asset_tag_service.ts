import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Create tags table
  await knex.schema.createTable("tags", (table) => {
    table.string("id").primary();
    table.string("name").notNullable().unique();
    table.string("color").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["name"]);
  });

  // Create asset_tags association table (Join Table)
  await knex.schema.createTable("asset_tags", (table) => {
    table
      .uuid("asset_id")
      .notNullable()
      .references("id")
      .inTable("assets")
      .onDelete("CASCADE");
    table
      .string("tag_id")
      .notNullable()
      .references("id")
      .inTable("tags")
      .onDelete("CASCADE");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.primary(["asset_id", "tag_id"]);
    table.index(["asset_id"]);
    table.index(["tag_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("asset_tags");
  await knex.schema.dropTableIfExists("tags");
}
