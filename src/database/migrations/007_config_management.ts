import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Config entries table
  await knex.schema.createTable("config_entries", (table) => {
    table.string("id").primary();
    table.string("key").notNullable();
    table.text("value").notNullable();
    table.string("environment").notNullable().defaultTo("default");
    table.boolean("is_sensitive").notNullable().defaultTo(false);
    table.integer("version").notNullable().defaultTo(1);
    table.string("created_by").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.unique(["key", "environment"]);
    table.index(["environment"]);
    table.index(["key"]);
  });

  // Feature flags table
  await knex.schema.createTable("feature_flags", (table) => {
    table.string("id").primary();
    table.string("name").notNullable();
    table.boolean("enabled").notNullable().defaultTo(false);
    table.string("environment").notNullable().defaultTo("default");
    table.integer("rollout_percentage").notNullable().defaultTo(100);
    table.jsonb("conditions").notNullable().defaultTo("{}");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.unique(["name", "environment"]);
    table.index(["environment"]);
  });

  // Config audit logs table
  await knex.schema.createTable("config_audit_logs", (table) => {
    table.string("id").primary();
    table.string("config_key").notNullable();
    table.enum("action", ["create", "update", "delete"]).notNullable();
    table.text("old_value");
    table.text("new_value");
    table.string("changed_by").notNullable();
    table.timestamp("timestamp").notNullable().defaultTo(knex.fn.now());

    table.index(["config_key"]);
    table.index(["timestamp"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("config_audit_logs");
  await knex.schema.dropTableIfExists("feature_flags");
  await knex.schema.dropTableIfExists("config_entries");
}
