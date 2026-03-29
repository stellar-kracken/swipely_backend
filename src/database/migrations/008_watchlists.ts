import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("watchlists", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("user_id").notNullable();
    table.string("name").notNullable();
    table.boolean("is_default").notNullable().defaultTo(false);
    table.timestamps(true, true);
    table.index(["user_id"]);
  });

  await knex.schema.createTable("watchlist_assets", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("watchlist_id").notNullable();
    table.string("symbol").notNullable();
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("added_at").notNullable().defaultTo(knex.fn.now());
    
    table.unique(["watchlist_id", "symbol"]);
    table.index(["watchlist_id", "sort_order"]);
    
    table
      .foreign("watchlist_id")
      .references("id")
      .inTable("watchlists")
      .onDelete("CASCADE");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("watchlist_assets");
  await knex.schema.dropTableIfExists("watchlists");
}
