import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Notification templates table
  await knex.schema.createTable("notification_templates", (table) => {
    table.string("id").primary();
    table.string("name").notNullable();
    table.text("description");
    table.enum("channel", ["email", "webhook", "in_app", "sms"]).notNullable();
    table.text("subject");
    table.text("body").notNullable();
    table.jsonb("variables").notNullable().defaultTo("[]");
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table
      .enum("status", ["draft", "pending_approval", "approved", "archived"])
      .notNullable()
      .defaultTo("draft");
    table.integer("version").notNullable().defaultTo(1);
    table.string("created_by").notNullable();
    table.string("approved_by");
    table.timestamp("approved_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["channel", "status"]);
    table.index(["name"]);
  });

  // Template versions table
  await knex.schema.createTable("template_versions", (table) => {
    table.string("id").primary();
    table
      .string("template_id")
      .notNullable()
      .references("id")
      .inTable("notification_templates")
      .onDelete("CASCADE");
    table.integer("version").notNullable();
    table.text("subject");
    table.text("body").notNullable();
    table.jsonb("variables").notNullable().defaultTo("[]");
    table.string("created_by").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.unique(["template_id", "version"]);
    table.index(["template_id", "version"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("template_versions");
  await knex.schema.dropTableIfExists("notification_templates");
}
