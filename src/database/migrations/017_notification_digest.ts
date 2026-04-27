import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Create digest_subscriptions table for user digest preferences
  await knex.schema.createTable("digest_subscriptions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("user_address").notNullable().unique();
    table.string("email").notNullable();
    table.boolean("daily_enabled").notNullable().defaultTo(true);
    table.boolean("weekly_enabled").notNullable().defaultTo(true);
    table.string("timezone").notNullable().defaultTo("UTC");
    table.integer("preferred_hour").notNullable().defaultTo(9); // 0-23, hour to send digest
    table.integer("preferred_day_of_week").notNullable().defaultTo(1); // 0-6, for weekly digest (0=Sunday)
    table.jsonb("quiet_hours").notNullable().defaultTo("{}"); // { start: 22, end: 7 }
    table.jsonb("included_alert_types").notNullable().defaultTo("[]"); // Filter which alerts to include
    table.jsonb("included_severities").notNullable().defaultTo('["high", "critical"]');
    table.boolean("include_trends").notNullable().defaultTo(true);
    table.boolean("include_unresolved").notNullable().defaultTo(true);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["user_address"]);
    table.index(["is_active"]);
  });

  // Create digest_deliveries table for tracking sent digests
  await knex.schema.createTable("digest_deliveries", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("subscription_id")
      .notNullable()
      .references("id")
      .inTable("digest_subscriptions")
      .onDelete("CASCADE");
    table.string("digest_type").notNullable(); // daily | weekly
    table.string("user_address").notNullable();
    table.string("email").notNullable();
    table.timestamp("period_start").notNullable();
    table.timestamp("period_end").notNullable();
    table.string("status").notNullable().defaultTo("pending"); // pending | sent | failed | skipped
    table.integer("alert_count").notNullable().defaultTo(0);
    table.integer("unresolved_count").notNullable().defaultTo(0);
    table.jsonb("summary_data").notNullable().defaultTo("{}");
    table.integer("attempts").notNullable().defaultTo(0);
    table.timestamp("sent_at").nullable();
    table.timestamp("next_retry_at").nullable();
    table.text("error_message").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["subscription_id"]);
    table.index(["user_address"]);
    table.index(["status"]);
    table.index(["digest_type"]);
    table.index(["created_at"]);
  });

  // Create digest_items table for individual items in a digest
  await knex.schema.createTable("digest_items", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("delivery_id")
      .notNullable()
      .references("id")
      .inTable("digest_deliveries")
      .onDelete("CASCADE");
    table.string("item_type").notNullable(); // alert | trend | unresolved
    table.string("alert_type").nullable();
    table.string("severity").nullable();
    table.string("asset_code").nullable();
    table.text("title").notNullable();
    table.text("summary").notNullable();
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.timestamp("occurred_at").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["delivery_id"]);
    table.index(["item_type"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("digest_items");
  await knex.schema.dropTableIfExists("digest_deliveries");
  await knex.schema.dropTableIfExists("digest_subscriptions");
}
