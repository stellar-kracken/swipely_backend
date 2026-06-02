import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("query_presets", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table.text("description");
    table.string("category").notNullable(); // reports, analytics, alerts, monitoring
    table.jsonb("query_definition").notNullable(); // stores filters, params, aggregations
    table.boolean("is_shared").notNullable().defaultTo(false);
    table.uuid("created_by").notNullable(); // user/api key owner
    table.string("version").notNullable().defaultTo("1.0.0");
    table.jsonb("access_rules").notNullable().defaultTo("{}"); // roles, permissions
    table.jsonb("metadata").defaultTo("{}"); // tags, usage stats, etc.
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("last_used_at");

    table.index(["category"]);
    table.index(["is_shared"]);
    table.index(["created_by"]);
    table.index(["name"]);
  });

  await knex.schema.createTable("query_preset_versions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("preset_id")
      .notNullable()
      .references("id")
      .inTable("query_presets")
      .onDelete("CASCADE");
    table.string("version").notNullable();
    table.jsonb("query_definition").notNullable();
    table.text("change_notes");
    table.uuid("created_by").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["preset_id", "version"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("query_preset_versions");
  await knex.schema.dropTableIfExists("query_presets");
}
