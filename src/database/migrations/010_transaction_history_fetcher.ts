import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("asset_transactions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("bridge_name").nullable().references("name").inTable("bridges").onDelete("SET NULL");
    table.string("asset_code").notNullable();
    table.string("asset_issuer").notNullable();
    table.string("transaction_hash").notNullable();
    table.string("operation_id").notNullable().unique();
    table.string("operation_type").notNullable();
    table.string("status").notNullable().defaultTo("completed");
    table.bigInteger("ledger").nullable();
    table.string("paging_token").notNullable();
    table.string("source_account").nullable();
    table.string("from_address").nullable();
    table.string("to_address").nullable();
    table.decimal("amount", 30, 8).notNullable().defaultTo(0);
    table.decimal("fee_charged", 30, 8).notNullable().defaultTo(0);
    table.timestamp("occurred_at", { useTz: true }).notNullable();
    table.jsonb("raw_transaction").nullable();
    table.jsonb("raw_operation").nullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["asset_code", "occurred_at"], "idx_asset_transactions_asset_time");
    table.index(["asset_code", "operation_type"], "idx_asset_transactions_asset_op");
    table.index(["bridge_name", "occurred_at"], "idx_asset_transactions_bridge_time");
    table.index(["status", "occurred_at"], "idx_asset_transactions_status_time");
    table.index(["transaction_hash"], "idx_asset_transactions_hash");
    table.index(["paging_token"], "idx_asset_transactions_paging_token");
  });

  await knex.schema.createTable("asset_transaction_sync_state", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("asset_code").notNullable();
    table.string("asset_issuer").notNullable();
    table.string("last_paging_token").nullable();
    table.bigInteger("last_ledger").nullable();
    table.integer("error_count").notNullable().defaultTo(0);
    table.text("last_error").nullable();
    table.timestamp("last_synced_at", { useTz: true }).nullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["asset_code", "asset_issuer"]);
    table.index(["asset_code"], "idx_asset_transaction_sync_state_asset");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("asset_transaction_sync_state");
  await knex.schema.dropTableIfExists("asset_transactions");
}
