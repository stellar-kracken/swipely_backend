import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Asset metadata table
  await knex.schema.createTable("asset_metadata", (table) => {
    table.string("id").primary();
    table
      .uuid("asset_id")
      .notNullable()
      .references("id")
      .inTable("assets")
      .onDelete("CASCADE");
    table.string("symbol").notNullable();
    table.text("logo_url");
    table.text("description");
    table.text("website_url");
    table.text("contract_address");
    table.jsonb("social_links").notNullable().defaultTo("{}");
    table.text("documentation_url");
    table.jsonb("token_specifications").notNullable().defaultTo("{}");
    table.string("category");
    table.jsonb("tags").notNullable().defaultTo("[]");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.unique(["asset_id"]);
    table.index(["symbol"]);
    table.index(["category"]);
  });

  // Asset metadata versions table
  await knex.schema.createTable("asset_metadata_versions", (table) => {
    table.string("id").primary();
    table
      .string("metadata_id")
      .notNullable()
      .references("id")
      .inTable("asset_metadata")
      .onDelete("CASCADE");
    table.integer("version").notNullable();
    table.jsonb("changes").notNullable();
    table.string("changed_by").notNullable();
    table.timestamp("timestamp").notNullable().defaultTo(knex.fn.now());

    table.index(["metadata_id", "version"]);
    table.index(["timestamp"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("asset_metadata_versions");
  await knex.schema.dropTableIfExists("asset_metadata");
}
