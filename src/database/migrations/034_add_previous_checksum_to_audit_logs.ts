import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("audit_logs", (table) => {
    table.string("previous_checksum", 64).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("audit_logs", (table) => {
    table.dropColumn("previous_checksum");
  });
}
