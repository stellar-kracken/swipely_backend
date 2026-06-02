import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Incidents table
  await knex.schema.createTable("incidents", (table) => {
    table.string("id").primary();
    table.string("title").notNullable();
    table.text("description");
    table.enum("severity", ["low", "medium", "high", "critical"]).notNullable();
    table
      .enum("status", [
        "open",
        "acknowledged",
        "investigating",
        "resolved",
        "closed",
      ])
      .notNullable()
      .defaultTo("open");
    table.integer("current_escalation_level").notNullable().defaultTo(1);
    table.string("assigned_to");
    table.timestamp("acknowledged_at");
    table.string("acknowledged_by");
    table.timestamp("resolved_at");
    table.string("resolved_by");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["status", "severity"]);
    table.index(["created_at"]);
  });

  // Escalation rules table
  await knex.schema.createTable("escalation_rules", (table) => {
    table.string("id").primary();
    table.string("name").notNullable();
    table.enum("severity", ["low", "medium", "high", "critical"]).notNullable();
    table.integer("from_level").notNullable();
    table.integer("to_level").notNullable();
    table.integer("timeout_minutes").notNullable();
    table.boolean("require_acknowledgement").notNullable().defaultTo(false);
    table.jsonb("notification_channels").notNullable().defaultTo("[]");
    table.jsonb("route_to").notNullable().defaultTo("[]");
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["severity", "from_level"]);
  });

  // Escalation history table
  await knex.schema.createTable("escalation_history", (table) => {
    table.string("id").primary();
    table
      .string("incident_id")
      .notNullable()
      .references("id")
      .inTable("incidents")
      .onDelete("CASCADE");
    table.integer("from_level").notNullable();
    table.integer("to_level").notNullable();
    table.text("reason").notNullable();
    table.enum("escalated_by", ["system", "manual"]).notNullable();
    table.timestamp("escalated_at").notNullable().defaultTo(knex.fn.now());
    table.jsonb("notified_users").notNullable().defaultTo("[]");

    table.index(["incident_id", "escalated_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("escalation_history");
  await knex.schema.dropTableIfExists("escalation_rules");
  await knex.schema.dropTableIfExists("incidents");
}
