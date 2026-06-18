import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Automation rules table
  await knex.schema.createTable("automation_rules", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table.text("description").nullable();
    table.string("asset_code").notNullable();
    table.jsonb("conditions").notNullable();
    table.string("logic_operator").notNullable().defaultTo("AND");
    table.jsonb("actions").notNullable(); // Array of actions to execute when triggered
    table.string("status").notNullable().defaultTo("active"); // active, inactive, draft
    table.string("owner_address").notNullable();
    table.integer("cooldown_seconds").notNullable().defaultTo(3600);
    table.timestamp("last_executed_at").nullable();
    table.integer("execution_count").notNullable().defaultTo(0);
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["owner_address"]);
    table.index(["asset_code", "status"]);
    table.index(["status"]);
    table.index(["updated_at"]);
  });

  // Automation rule versions - audit trail for rule changes
  await knex.schema.createTable("automation_rule_versions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("rule_id")
      .notNullable()
      .references("id")
      .inTable("automation_rules")
      .onDelete("CASCADE");
    table.integer("version").notNullable();
    table.jsonb("snapshot").notNullable(); // Full rule snapshot
    table.string("changed_by").notNullable(); // Actor who made the change
    table.string("change_type").notNullable().defaultTo("update"); // create, update, delete, activate, deactivate
    table.text("change_reason").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["rule_id", "version"]);
    table.index(["changed_by"]);
    table.index(["created_at"]);
  });

  // Automation rule executions - history of rule runs
  await knex.schema.createTable("automation_rule_executions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("rule_id")
      .notNullable()
      .references("id")
      .inTable("automation_rules")
      .onDelete("CASCADE");
    table.integer("rule_version").notNullable();
    table.jsonb("input_metrics").notNullable();
    table.jsonb("condition_results").notNullable();
    table.boolean("triggered").notNullable();
    table.jsonb("actions_executed").nullable(); // Results of action execution
    table.jsonb("action_results").nullable(); // Detailed results per action
    table.string("status").notNullable().defaultTo("completed"); // completed, failed, partial
    table.text("error_message").nullable();
    table.string("executed_by").notNullable(); // Actor who triggered execution (system, user, schedule)
    table.timestamp("started_at").notNullable();
    table.timestamp("completed_at").nullable();
    table.integer("duration_ms").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["rule_id", "created_at"]);
    table.index(["rule_version"]);
    table.index(["executed_by"]);
    table.index(["status"]);
    table.index(["triggered"]);
    table.index(["created_at"]);
  });

  // Add actor tracking columns to existing rule_evaluator_logs table
  await knex.schema.alterTable("rule_evaluator_logs", (table) => {
    table.string("executed_by").nullable(); // Actor who triggered evaluation (system, user, schedule)
    table.string("execution_context").nullable(); // Context: manual, scheduled, webhook, api
    table.jsonb("metadata").nullable().defaultTo("{}"); // Additional metadata
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("automation_rule_executions");
  await knex.schema.dropTableIfExists("automation_rule_versions");
  await knex.schema.dropTableIfExists("automation_rules");

  await knex.schema.alterTable("rule_evaluator_logs", (table) => {
    table.dropColumn("executed_by");
    table.dropColumn("execution_context");
    table.dropColumn("metadata");
  });
}