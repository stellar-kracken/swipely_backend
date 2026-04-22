import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tracked_balances", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("asset_code").notNullable();
    table.string("asset_issuer").nullable();
    table.string("address_label").notNullable();
    table.string("address").notNullable();
    table.string("chain").notNullable();
    table.string("address_type").notNullable();
    table.decimal("current_balance", 30, 8).notNullable().defaultTo(0);
    table.decimal("previous_balance", 30, 8).notNullable().defaultTo(0);
    table.decimal("balance_change", 30, 8).notNullable().defaultTo(0);
    table.decimal("change_percentage", 20, 8).notNullable().defaultTo(0);
    table.timestamp("last_checked_at", { useTz: true }).nullable();
    table.timestamp("last_changed_at", { useTz: true }).nullable();
    table.jsonb("metadata").nullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["address", "chain", "asset_code"], { indexName: "uq_tracked_balances_address_chain_asset" });
    table.index(["asset_code", "chain"], "idx_tracked_balances_asset_chain");
    table.index(["address_type", "chain"], "idx_tracked_balances_type_chain");
  });

  await knex.schema.createTable("balance_history", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("tracked_balance_id").notNullable().references("id").inTable("tracked_balances").onDelete("CASCADE");
    table.string("asset_code").notNullable();
    table.string("chain").notNullable();
    table.string("address").notNullable();
    table.decimal("balance", 30, 8).notNullable().defaultTo(0);
    table.decimal("balance_change", 30, 8).notNullable().defaultTo(0);
    table.decimal("change_percentage", 20, 8).notNullable().defaultTo(0);
    table.bigInteger("block_number").nullable();
    table.timestamp("recorded_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.jsonb("metadata").nullable();

    table.index(["tracked_balance_id", "recorded_at"], "idx_balance_history_tracked_time");
    table.index(["asset_code", "recorded_at"], "idx_balance_history_asset_time");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("balance_history");
  await knex.schema.dropTableIfExists("tracked_balances");
}
