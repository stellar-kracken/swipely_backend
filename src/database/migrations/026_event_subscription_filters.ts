import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("event_subscriptions", (table) => {
    table.string("id").primary();
    table.string("user_id").notNullable();
    table.string("name").notNullable();
    table.jsonb("filter").notNullable().defaultTo("{}");
    table.specificType("delivery_channels", "text[]").notNullable().defaultTo("{in_app}");
    table.string("delivery_destination");
    table.boolean("enabled").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["user_id"]);
    table.index(["enabled"]);
  });

  await knex.schema.createTable("event_subscription_audit_logs", (table) => {
    table.string("id").primary();
    table.string("subscription_id").notNullable();
    table.string("user_id").notNullable();
    table.enum("action", ["created", "updated", "deleted", "matched", "preview"]).notNullable();
    table.text("detail");
    table.timestamp("timestamp").notNullable().defaultTo(knex.fn.now());

    table.index(["subscription_id"]);
    table.index(["user_id"]);
    table.index(["timestamp"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("event_subscription_audit_logs");
  await knex.schema.dropTableIfExists("event_subscriptions");
}
