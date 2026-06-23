import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("cross_chain_verification_log", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.text("bridge_id").notNullable();
    table.text("status").notNullable();
    table.decimal("mismatch_pct", 10, 4).notNullable().defaultTo(0);
    table.boolean("state_consistent").notNullable().defaultTo(false);
    table.boolean("merkle_proof_valid").nullable();
    table.jsonb("payload").notNullable();
    table.timestamp("verified_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["bridge_id"]);
    table.index(["verified_at"]);
    table.index(["status"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("cross_chain_verification_log");
}
