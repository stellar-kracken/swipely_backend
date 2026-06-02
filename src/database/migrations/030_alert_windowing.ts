import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("alert_windows", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("asset_code").notNullable();
    table.string("alert_type").notNullable();
    table.timestamp("window_start").notNullable();
    table.timestamp("window_end").notNullable();
    table.integer("alert_count").notNullable().defaultTo(0);
    table.jsonb("summary_stats").notNullable().defaultTo("{}");
    table.string("status").notNullable().defaultTo("open");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["asset_code", "window_start", "window_end"]);
    table.index(["alert_type"]);
    table.index(["status"]);
    table.index(["window_end"]);
  });

  await knex.schema.createTable("alert_window_summaries", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("window_id")
      .notNullable()
      .references("id")
      .inTable("alert_windows")
      .onDelete("CASCADE");
    table.jsonb("severity_breakdown").notNullable().defaultTo("{}");
    table.jsonb("top_alerts").notNullable().defaultTo("[]");
    table.jsonb("aggregated_metrics").notNullable().defaultTo("{}");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["window_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alert_window_summaries");
  await knex.schema.dropTableIfExists("alert_windows");
}
