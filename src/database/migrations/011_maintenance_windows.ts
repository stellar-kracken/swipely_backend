import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Maintenance windows table
  await knex.schema.createTable("maintenance_windows", (table) => {
    table.string("id").primary();
    table.string("title").notNullable();
    table.text("description");
    table.enum("scope", ["global", "bridge", "asset", "service"]).notNullable();
    table.string("scope_identifier");
    table.timestamp("start_time").notNullable();
    table.timestamp("end_time").notNullable();
    table
      .enum("status", ["scheduled", "active", "completed", "cancelled"])
      .notNullable()
      .defaultTo("scheduled");
    table.boolean("suppress_alerts").notNullable().defaultTo(true);
    table.jsonb("alert_types_suppressed").notNullable().defaultTo("[]");
    table.string("created_by").notNullable();
    table.string("approved_by");
    table.timestamp("approved_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.string("timezone").notNullable().defaultTo("UTC");

    table.index(["status", "start_time"]);
    table.index(["scope", "scope_identifier"]);
  });

  // Maintenance audit logs table
  await knex.schema.createTable("maintenance_audit_logs", (table) => {
    table.string("id").primary();
    table
      .string("window_id")
      .notNullable()
      .references("id")
      .inTable("maintenance_windows")
      .onDelete("CASCADE");
    table
      .enum("action", [
        "created",
        "updated",
        "started",
        "completed",
        "cancelled",
        "approved",
      ])
      .notNullable();
    table.string("performed_by").notNullable();
    table.jsonb("details").notNullable().defaultTo("{}");
    table.timestamp("timestamp").notNullable().defaultTo(knex.fn.now());

    table.index(["window_id", "timestamp"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("maintenance_audit_logs");
  await knex.schema.dropTableIfExists("maintenance_windows");
}
