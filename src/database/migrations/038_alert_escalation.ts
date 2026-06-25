import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Alert escalation rules table
  await knex.schema.createTable("alert_escalation_rules", (table) => {
    table.string("id").primary();
    table.string("asset_code").notNullable();
    table.string("alert_type").notNullable();
    table
      .enum("from_severity", ["low", "medium", "high", "critical"])
      .notNullable();
    table
      .enum("to_severity", ["low", "medium", "high", "critical"])
      .notNullable();
    table
      .enum("trigger_type", ["frequency", "duration", "recurrence", "manual"])
      .notNullable();
    table.integer("frequency_threshold"); // For frequency-based escalation
    table.integer("duration_minutes"); // For duration-based escalation
    table.integer("recurrence_count"); // For recurrence-based escalation
    table.integer("time_window_minutes").notNullable().defaultTo(60);
    table.boolean("allow_manual_override").notNullable().defaultTo(true);
    table.jsonb("notification_channels").notNullable().defaultTo("[]");
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["asset_code", "alert_type"]);
    table.index(["from_severity", "to_severity"]);
    table.index(["is_active"]);
  });

  // Alert condition history table
  await knex.schema.createTable("alert_condition_history", (table) => {
    table.string("id").primary();
    table
      .string("alert_rule_id")
      .notNullable()
      .references("id")
      .inTable("alert_rules")
      .onDelete("CASCADE");
    table.string("asset_code").notNullable();
    table.string("alert_type").notNullable();
    table.integer("occurrence_count").notNullable().defaultTo(0);
    table.timestamp("first_occurrence_at").notNullable();
    table.timestamp("last_occurrence_at").notNullable();
    table.integer("total_duration_minutes").notNullable().defaultTo(0);
    table
      .enum("current_severity", ["low", "medium", "high", "critical"])
      .notNullable();
    table.enum("escalated_severity", ["low", "medium", "high", "critical"]); // NULL if not escalated
    table.jsonb("escalation_history").notNullable().defaultTo("[]");
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["alert_rule_id", "is_active"]);
    table.index(["asset_code", "alert_type"]);
    table.index(["first_occurrence_at"]);
    table.index(["is_active"]);
  });

  // Alert escalation events table
  await knex.schema.createTable("alert_escalation_events", (table) => {
    table.string("id").primary();
    table
      .string("condition_history_id")
      .notNullable()
      .references("id")
      .inTable("alert_condition_history")
      .onDelete("CASCADE");
    table
      .enum("from_severity", ["low", "medium", "high", "critical"])
      .notNullable();
    table
      .enum("to_severity", ["low", "medium", "high", "critical"])
      .notNullable();
    table
      .enum("trigger", ["frequency", "duration", "recurrence", "manual"])
      .notNullable();
    table.text("reason").notNullable();
    table.timestamp("escalated_at").notNullable();
    table
      .enum("escalated_by", ["system", "manual"])
      .notNullable()
      .defaultTo("system");
    table.string("manual_override_by"); // User who manually overrode
    table.text("manual_override_reason"); // Reason for manual override

    table.index(["condition_history_id", "escalated_at"]);
    table.index(["escalated_at"]);
    table.index(["escalated_by"]);
  });

  // Create index for better query performance on alert condition history lookups
  await knex.schema.table("alert_condition_history", (table) => {
    table.unique(["alert_rule_id", "asset_code"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alert_escalation_events");
  await knex.schema.dropTableIfExists("alert_condition_history");
  await knex.schema.dropTableIfExists("alert_escalation_rules");
}
