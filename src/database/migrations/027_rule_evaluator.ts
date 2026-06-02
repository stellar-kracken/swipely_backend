import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("rule_evaluator_logs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("rule_id").nullable();
    table.string("rule_name").notNullable();
    table.string("asset_code").notNullable();
    table.jsonb("input_metrics").notNullable().defaultTo("{}");
    table.jsonb("evaluation_result").notNullable();
    table.boolean("triggered").notNullable();
    table.string("logic_operator").notNullable();
    table.boolean("preview_mode").notNullable().defaultTo(false);
    table.timestamp("evaluated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["rule_id", "evaluated_at"]);
    table.index(["asset_code", "evaluated_at"]);
    table.index(["triggered"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("rule_evaluator_logs");
}
