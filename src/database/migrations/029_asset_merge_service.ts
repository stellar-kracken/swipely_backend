import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("asset_merge_logs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("primary_asset_id").notNullable();
    table.string("primary_symbol").notNullable();
    table.jsonb("merged_asset_ids").notNullable();
    table.jsonb("merge_rules_applied").notNullable().defaultTo("{}");
    table.jsonb("conflicts_resolved").notNullable().defaultTo("[]");
    table.string("status").notNullable().defaultTo("completed");
    table.string("triggered_by").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["primary_asset_id"]);
    table.index(["status"]);
    table.index(["created_at"]);
  });

  await knex.schema.createTable("asset_merge_reviews", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.jsonb("duplicate_group").notNullable();
    table.jsonb("suggested_merge").notNullable();
    table.string("status").notNullable().defaultTo("pending");
    table.string("reviewed_by").nullable();
    table.text("review_notes").nullable();
    table.timestamp("reviewed_at").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["status"]);
    table.index(["created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("asset_merge_reviews");
  await knex.schema.dropTableIfExists("asset_merge_logs");
}
