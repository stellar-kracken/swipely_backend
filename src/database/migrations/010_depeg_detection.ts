import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Depeg events table
  await knex.schema.createTable("depeg_events", (table) => {
    table.string("id").primary();
    table.string("symbol").notNullable();
    table.decimal("peg_value", 10, 6).notNullable();
    table.decimal("current_price", 10, 6).notNullable();
    table.decimal("deviation_percent", 10, 6).notNullable();
    table.enum("severity", ["warning", "moderate", "severe", "critical"]);
    table
      .enum("status", ["active", "recovering", "resolved"])
      .notNullable()
      .defaultTo("active");
    table.jsonb("sources").notNullable();
    table.enum("trend", ["worsening", "improving", "stable"]).notNullable();
    table.timestamp("detected_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("resolved_at");
    table.integer("duration_seconds");
    table.decimal("max_deviation", 10, 6).notNullable();
    table.integer("recovery_time");

    table.index(["symbol", "status"]);
    table.index(["detected_at"]);
    table.index(["severity"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("depeg_events");
}
