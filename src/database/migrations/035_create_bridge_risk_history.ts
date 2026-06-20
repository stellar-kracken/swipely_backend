import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("bridge_risk_history", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.text("bridge_id").notNullable();
    table.decimal("risk_score");
    table.decimal("reserve_score");
    table.decimal("reputation_score");
    table.decimal("volume_score");
    table.decimal("anomaly_score");
    table.decimal("resolution_score");
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());

    table.index(["bridge_id"]);
    table.index(["created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("bridge_risk_history");
}
