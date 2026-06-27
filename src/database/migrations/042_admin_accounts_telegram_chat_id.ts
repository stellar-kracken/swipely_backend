import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("admin_accounts", (table) => {
    table.string("telegram_chat_id").nullable().unique();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("admin_accounts", (table) => {
    table.dropColumn("telegram_chat_id");
  });
}
