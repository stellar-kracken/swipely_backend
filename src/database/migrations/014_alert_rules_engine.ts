import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Extended alert rules table (versioned, with time windows and templates)
  await knex.schema.createTable("alert_rules_v2", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("owner_address").notNullable();
    table.string("name").notNullable();
    table.text("description").nullable();
    table.string("asset_code").notNullable();
    table.jsonb("conditions").notNullable();
    table.string("logic_operator").notNullable().defaultTo("AND");
    table.string("priority").notNullable().defaultTo("medium");
    table.string("status").notNullable().defaultTo("active");
    table.integer("cooldown_seconds").notNullable().defaultTo(3600);
    table.jsonb("time_window").nullable();
    table.integer("version").notNullable().defaultTo(1);
    table.string("template_id").nullable();
    table.string("webhook_url").nullable();
    table.timestamp("last_triggered_at").nullable();
    table.timestamps(true, true);

    table.index(["owner_address"]);
    table.index(["asset_code", "status"]);
    table.index(["priority"]);
    table.index(["template_id"]);
  });

  // Version history — one row per edit
  await knex.schema.createTable("alert_rule_versions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("rule_id")
      .notNullable()
      .references("id")
      .inTable("alert_rules_v2")
      .onDelete("CASCADE");
    table.integer("version").notNullable();
    table.jsonb("snapshot").notNullable();
    table.string("changed_by").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["rule_id", "version"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alert_rule_versions");
  await knex.schema.dropTableIfExists("alert_rules_v2");
}
