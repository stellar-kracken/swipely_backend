import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("source_health_scores", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("source_key", 120).notNullable();
    table.string("display_name", 255).notNullable().defaultTo("");
    table.string("category", 80).notNullable().defaultTo("unknown");
    table.decimal("overall_score", 5, 2).notNullable().defaultTo(0);
    table.decimal("uptime_score", 5, 2).notNullable().defaultTo(0);
    table.decimal("latency_score", 5, 2).notNullable().defaultTo(0);
    table.decimal("accuracy_score", 5, 2).notNullable().defaultTo(0);
    table.decimal("responsiveness_score", 5, 2).notNullable().defaultTo(0);
    table.string("grade", 1).notNullable().defaultTo("F");
    table.string("alert_state", 20).notNullable().defaultTo("ok");
    table.jsonb("contributing_factors").notNullable().defaultTo("{}");
    table.jsonb("threshold_violations").notNullable().defaultTo("[]");
    table.integer("sample_count").notNullable().defaultTo(0);
    table.timestamp("computed_at").notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
    table.unique(["source_key"]);
    table.index(["alert_state"]);
    table.index(["overall_score"]);
    table.index(["computed_at"]);
  });

  await knex.schema.createTable("source_health_score_history", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("source_key", 120).notNullable();
    table.decimal("overall_score", 5, 2).notNullable();
    table.decimal("uptime_score", 5, 2).notNullable();
    table.decimal("latency_score", 5, 2).notNullable();
    table.decimal("accuracy_score", 5, 2).notNullable();
    table.decimal("responsiveness_score", 5, 2).notNullable();
    table.string("grade", 1).notNullable();
    table.string("alert_state", 20).notNullable();
    table.integer("sample_count").notNullable().defaultTo(0);
    table.timestamp("computed_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["source_key"]);
    table.index(["source_key", "computed_at"]);
    table.index(["computed_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("source_health_score_history");
  await knex.schema.dropTableIfExists("source_health_scores");
}
