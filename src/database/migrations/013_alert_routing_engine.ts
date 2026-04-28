import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("alert_routing_rules", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table.string("owner_address").nullable();
    table.jsonb("severity_levels").notNullable().defaultTo(knex.raw("'[\"critical\",\"high\",\"medium\",\"low\"]'::jsonb"));
    table.jsonb("asset_codes").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb("source_types").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.jsonb("channels").notNullable().defaultTo(knex.raw("'[\"in_app\"]'::jsonb"));
    table.jsonb("fallback_channels").notNullable().defaultTo(knex.raw("'[\"in_app\"]'::jsonb"));
    table.integer("suppression_window_seconds").notNullable().defaultTo(0);
    table.integer("priority_order").notNullable().defaultTo(100);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.string("created_by").nullable();
    table.timestamps(true, true);

    table.index(["owner_address", "is_active"]);
    table.index(["priority_order"]);
  });

  await knex.schema.createTable("alert_routing_audit", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.timestamp("event_time").notNullable();
    table.uuid("alert_rule_id").notNullable();
    table
      .uuid("routing_rule_id")
      .nullable()
      .references("id")
      .inTable("alert_routing_rules")
      .onDelete("SET NULL");
    table.string("owner_address").notNullable();
    table.string("asset_code").notNullable();
    table.string("source_type").notNullable();
    table.string("severity").notNullable();
    table.string("channel").notNullable();
    table.string("status").notNullable();
    table.text("reason").nullable();
    table.integer("attempt_count").notNullable().defaultTo(0);
    table.integer("latency_ms").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["owner_address", "created_at"]);
    table.index(["asset_code", "source_type", "channel", "created_at"]);
    table.index(["status", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alert_routing_audit");
  await knex.schema.dropTableIfExists("alert_routing_rules");
}
