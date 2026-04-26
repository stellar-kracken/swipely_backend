import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("asset_metadata", (table) => {
    table.boolean("sync_enabled").notNullable().defaultTo(true);
    table.boolean("manual_override").notNullable().defaultTo(false);
    table.text("override_reason").nullable();
    table.string("override_updated_by").nullable();
    table.timestamp("last_synced_at").nullable();
    table.string("last_sync_status").notNullable().defaultTo("never");
    table.text("last_sync_error").nullable();
    table.jsonb("source_priority").notNullable().defaultTo('["static-registry","coingecko","stellar-expert"]');
    table.timestamp("image_last_validated_at").nullable();
  });

  await knex.schema.createTable("asset_metadata_sync_runs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("asset_id").nullable().references("id").inTable("assets").onDelete("SET NULL");
    table.string("symbol").notNullable();
    table.string("status").notNullable();
    table.string("source").nullable();
    table.boolean("selective_refresh").notNullable().defaultTo(false);
    table.jsonb("selected_fields").notNullable().defaultTo("[]");
    table.integer("sources_attempted").notNullable().defaultTo(0);
    table.integer("sources_succeeded").notNullable().defaultTo(0);
    table.boolean("conflict_resolved").notNullable().defaultTo(false);
    table.jsonb("conflicts").notNullable().defaultTo("[]");
    table.jsonb("applied_changes").notNullable().defaultTo("{}");
    table.text("error_message").nullable();
    table.string("triggered_by").notNullable().defaultTo("system");
    table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("completed_at").nullable();

    table.index(["symbol", "started_at"]);
    table.index(["status", "started_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("asset_metadata_sync_runs");

  await knex.schema.alterTable("asset_metadata", (table) => {
    table.dropColumn("sync_enabled");
    table.dropColumn("manual_override");
    table.dropColumn("override_reason");
    table.dropColumn("override_updated_by");
    table.dropColumn("last_synced_at");
    table.dropColumn("last_sync_status");
    table.dropColumn("last_sync_error");
    table.dropColumn("source_priority");
    table.dropColumn("image_last_validated_at");
  });
}
