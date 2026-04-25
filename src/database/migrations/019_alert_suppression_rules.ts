import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("alert_suppression_rules", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable();
    table.text("description").nullable();
    table.boolean("is_active").notNullable().defaultTo(true);

    table.jsonb("asset_codes").nullable();
    table.jsonb("alert_types").nullable();
    table.jsonb("priorities").nullable();
    table.jsonb("sources").nullable();
    table.jsonb("days_of_week").nullable();

    table.timestamp("window_start").nullable();
    table.timestamp("window_end").nullable();
    table.boolean("maintenance_mode").notNullable().defaultTo(false);
    table.timestamp("expires_at").nullable();

    table.string("created_by").notNullable();
    table.string("updated_by").notNullable();
    table.timestamps(true, true);

    table.index(["is_active", "expires_at"]);
    table.index(["maintenance_mode"]);
    table.index(["window_start", "window_end"]);
  });

  await knex.schema.createTable("alert_suppression_audit", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("rule_id")
      .nullable()
      .references("id")
      .inTable("alert_suppression_rules")
      .onDelete("SET NULL");
    table.string("action").notNullable();
    table.string("actor").notNullable();
    table.jsonb("details").notNullable().defaultTo("{}" as unknown as Knex.Raw);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["rule_id", "created_at"]);
    table.index(["action"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alert_suppression_audit");
  await knex.schema.dropTableIfExists("alert_suppression_rules");
}
