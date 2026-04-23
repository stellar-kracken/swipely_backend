import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("webhook_endpoints", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("owner_address").notNullable();
    table.string("url").notNullable();
    table.string("name").notNullable();
    table.text("description").nullable();
    table.string("secret").notNullable();
    table.timestamp("secret_rotated_at").nullable();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.integer("rate_limit_per_minute").notNullable().defaultTo(60);
    table.jsonb("custom_headers").notNullable().defaultTo("{}");
    table.jsonb("filter_event_types").notNullable().defaultTo("[]");
    table.boolean("is_batch_delivery_enabled").notNullable().defaultTo(false);
    table.integer("batch_window_ms").notNullable().defaultTo(5000);
    table.timestamps(true, true);
    table.index(["owner_address"]);
    table.index(["is_active"]);
  });

  await knex.schema.createTable("webhook_deliveries", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("webhook_endpoint_id")
      .notNullable()
      .references("id")
      .inTable("webhook_endpoints")
      .onDelete("CASCADE");
    table.string("event_type").notNullable();
    table.jsonb("payload").notNullable();
    table.string("status").notNullable().defaultTo("pending");
    table.integer("attempts").notNullable().defaultTo(0);
    table.timestamp("last_attempt_at").nullable();
    table.timestamp("next_retry_at").nullable();
    table.integer("response_status").nullable();
    table.text("response_body").nullable();
    table.text("error_message").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["webhook_endpoint_id"]);
    table.index(["status"]);
    table.index(["created_at"]);
  });

  await knex.schema.createTable("webhook_delivery_logs", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("webhook_endpoint_id")
      .notNullable()
      .references("id")
      .inTable("webhook_endpoints")
      .onDelete("CASCADE");
    table
      .uuid("webhook_delivery_id")
      .notNullable()
      .references("id")
      .inTable("webhook_deliveries")
      .onDelete("CASCADE");
    table.string("event_type").notNullable();
    table.jsonb("request_headers").notNullable();
    table.text("request_body").notNullable();
    table.integer("response_status").nullable();
    table.text("response_body").nullable();
    table.integer("duration_ms").notNullable().defaultTo(0);
    table.integer("attempt_number").notNullable().defaultTo(1);
    table.text("error_message").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["webhook_delivery_id"]);
    table.index(["webhook_endpoint_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("webhook_delivery_logs");
  await knex.schema.dropTableIfExists("webhook_deliveries");
  await knex.schema.dropTableIfExists("webhook_endpoints");
}
