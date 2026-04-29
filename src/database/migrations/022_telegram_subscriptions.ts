import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Telegram subscriptions table
  await knex.schema.createTable("telegram_subscriptions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("chat_id").notNullable().unique(); // Telegram chat ID
    table.enum("chat_type", ["private", "group", "supergroup", "channel"]).notNullable(); // Type of Telegram chat
    table.string("telegram_user_id").nullable(); // Original user ID if linkable
    table.json("severities").notNullable().defaultTo(JSON.stringify(["critical", "high"])); // Array of severity levels to subscribe to
    table.json("areas").nullable().defaultTo(JSON.stringify([])); // Array of domain areas for future filtering
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    // Indexes for efficient querying
    table.index(["is_active"]);
    table.index(["chat_type"]);
    table.index(["created_at"]);
    table.index(["updated_at"]);
  });

  // Telegram alerts delivery log (hypertable for time-series data)
  await knex.schema.createTable("telegram_alerts_log", (table) => {
    table.timestamp("time").notNullable().defaultTo(knex.fn.now());
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("subscription_id").notNullable();
    table.string("chat_id").notNullable();
    table.string("alert_id").notNullable();
    table.string("alert_type").notNullable(); // price_deviation, supply_mismatch, etc.
    table.enum("priority", ["critical", "high", "medium", "low"]).notNullable(); // Alert priority
    table.string("asset_code").notNullable();
    table.string("metric_name").notNullable();
    table.text("triggered_value").notNullable();
    table.text("threshold").notNullable();
    table.string("message_id").nullable(); // Telegram message ID for tracking
    table.boolean("delivered").notNullable().defaultTo(false);
    table.text("error_message").nullable();

    // Indexes for efficient querying and time-series operations
    table.index(["subscription_id", "time"]);
    table.index(["chat_id", "time"]);
    table.index(["alert_type", "time"]);
    table.index(["priority", "time"]);
    table.index(["delivered", "time"]);
    table.index("time");
  });

  // Convert telegram_alerts_log to TimescaleDB hypertable for efficient time-series queries
  try {
    await knex.raw("SELECT create_hypertable('telegram_alerts_log', 'time', if_not_exists => true)");
  } catch (error: any) {
    if (!error.message?.includes("already exists")) {
      throw error;
    }
  }

  // Add compression policy for old data (compress data older than 7 days)
  try {
    await knex.raw(`
      SELECT add_compression_policy('telegram_alerts_log', INTERVAL '7 days', if_not_exists => true)
    `);
  } catch (error: any) {
    if (!error.message?.includes("already exists")) {
      // Silently ignore if policy already exists
    }
  }

  // Create index on telegram_subscriptions for efficient bulk operations
  try {
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_telegram_subscriptions_severities ON telegram_subscriptions USING GIN(severities)"
    );
  } catch (error: any) {
    // Silently ignore if index already exists
  }

  // Create index on telegram_subscriptions for active chats
  try {
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_telegram_subscriptions_active_chat ON telegram_subscriptions(is_active, chat_id) WHERE is_active = true"
    );
  } catch (error: any) {
    // Silently ignore if index already exists
  }
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order of dependencies
  // Note: TimescaleDB hypertables should be handled automatically by Knex
  await knex.schema.dropTableIfExists("telegram_alerts_log");
  await knex.schema.dropTableIfExists("telegram_subscriptions");
}
