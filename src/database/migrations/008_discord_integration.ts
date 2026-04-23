import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Discord subscriptions table
  await knex.schema.createTable("discord_subscriptions", (table) => {
    table.string("id").primary(); // guildId-channelId
    table.string("guild_id").notNullable();
    table.string("channel_id").notNullable();
    table.json("alert_types").notNullable(); // Array of alert types
    table.json("assets").nullable(); // Array of specific assets to monitor
    table.json("bridges").nullable(); // Array of specific bridges to monitor
    table.string("min_severity").defaultTo("low"); // low, medium, high, critical
    table.boolean("is_active").defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    
    // Indexes
    table.index(["guild_id", "channel_id"]);
    table.index("is_active");
    table.index("min_severity");
    table.unique(["guild_id", "channel_id"]);
  });

  // Discord alerts log table (hypertable for time-series data)
  await knex.schema.createTable("discord_alerts_log", (table) => {
    table.timestamp("time").notNullable().defaultTo(knex.fn.now());
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("subscription_id").notNullable();
    table.string("alert_id").notNullable();
    table.string("alert_type").notNullable(); // bridge, pool, price, health
    table.string("severity").notNullable(); // low, medium, high, critical
    table.string("title").notNullable();
    table.text("description").notNullable();
    table.json("metadata").nullable();
    table.string("guild_id").notNullable();
    table.string("channel_id").notNullable();
    table.string("message_id").nullable(); // Discord message ID for tracking
    table.boolean("delivered").defaultTo(false);
    table.text("error_message").nullable();
    
    // Indexes
    table.index(["subscription_id", "time"]);
    table.index(["guild_id", "channel_id"]);
    table.index("alert_type");
    table.index("severity");
    table.index("delivered");
    table.index("time");
  });

  // Convert discord_alerts_log to TimescaleDB hypertable
  await knex.raw(
    "SELECT create_hypertable('discord_alerts_log', 'time', if_not_exists => TRUE)"
  );

  // Discord commands usage table (hypertable for analytics)
  await knex.schema.createTable("discord_commands_usage", (table) => {
    table.timestamp("time").notNullable().defaultTo(knex.fn.now());
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("guild_id").notNullable();
    table.string("channel_id").notNullable();
    table.string("user_id").notNullable();
    table.string("command_name").notNullable();
    table.json("options").nullable(); // Command options/parameters
    table.integer("response_time_ms").defaultTo(0);
    table.boolean("success").defaultTo(true);
    table.text("error_message").nullable();
    
    // Indexes
    table.index(["guild_id", "time"]);
    table.index("command_name");
    table.index("user_id");
    table.index("success");
    table.index("time");
  });

  // Convert discord_commands_usage to TimescaleDB hypertable
  await knex.raw(
    "SELECT create_hypertable('discord_commands_usage', 'time', if_not_exists => TRUE)"
  );

  // Discord guild settings table
  await knex.schema.createTable("discord_guild_settings", (table) => {
    table.string("guild_id").primary();
    table.string("guild_name").nullable();
    table.string("admin_role_id").nullable(); // Role that can manage bot
    table.boolean("alerts_enabled").defaultTo(true);
    table.string("default_alert_channel_id").nullable();
    table.string("default_min_severity").defaultTo("medium");
    table.json("disabled_commands").nullable(); // Array of disabled commands
    table.json("custom_prefixes").nullable(); // Custom command prefixes
    table.boolean("analytics_enabled").defaultTo(true);
    table.timestamp("last_activity").nullable();
    table.timestamps(true, true);
    
    // Indexes
    table.index("alerts_enabled");
    table.index("last_activity");
  });

  // Create function to log Discord command usage
  await knex.raw(`
    CREATE OR REPLACE FUNCTION log_discord_command_usage(
      p_guild_id TEXT,
      p_channel_id TEXT,
      p_user_id TEXT,
      p_command_name TEXT,
      p_options JSONB DEFAULT NULL,
      p_response_time_ms INTEGER DEFAULT 0,
      p_success BOOLEAN DEFAULT true,
      p_error_message TEXT DEFAULT NULL
    )
    RETURNS VOID AS $$
    BEGIN
      INSERT INTO discord_commands_usage (
        guild_id, channel_id, user_id, command_name, 
        options, response_time_ms, success, error_message, time
      ) VALUES (
        p_guild_id, p_channel_id, p_user_id, p_command_name,
        p_options, p_response_time_ms, p_success, p_error_message, NOW()
      );
    END;
    $$ LANGUAGE plpgsql
  `);

  // Create function to log Discord alerts
  await knex.raw(`
    CREATE OR REPLACE FUNCTION log_discord_alert(
      p_subscription_id TEXT,
      p_alert_id TEXT,
      p_alert_type TEXT,
      p_severity TEXT,
      p_title TEXT,
      p_description TEXT,
      p_metadata JSONB DEFAULT NULL,
      p_guild_id TEXT,
      p_channel_id TEXT,
      p_message_id TEXT DEFAULT NULL,
      p_delivered BOOLEAN DEFAULT false,
      p_error_message TEXT DEFAULT NULL
    )
    RETURNS VOID AS $$
    BEGIN
      INSERT INTO discord_alerts_log (
        subscription_id, alert_id, alert_type, severity, title, description,
        metadata, guild_id, channel_id, message_id, delivered, error_message, time
      ) VALUES (
        p_subscription_id, p_alert_id, p_alert_type, p_severity, p_title, p_description,
        p_metadata, p_guild_id, p_channel_id, p_message_id, p_delivered, p_error_message, NOW()
      );
    END;
    $$ LANGUAGE plpgsql
  `);

  // Create trigger to update guild last activity
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_guild_activity()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO discord_guild_settings (guild_id, last_activity)
      VALUES (NEW.guild_id, NOW())
      ON CONFLICT (guild_id) 
      DO UPDATE SET 
        last_activity = EXCLUDED.last_activity,
        guild_name = COALESCE(NEW.guild_name, discord_guild_settings.guild_name);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  // Create trigger for command usage
  await knex.raw(`
    CREATE TRIGGER trigger_update_guild_activity_command
    AFTER INSERT ON discord_commands_usage
    FOR EACH ROW
    EXECUTE FUNCTION update_guild_activity()
  `);

  // Create trigger for alerts
  await knex.raw(`
    CREATE TRIGGER trigger_update_guild_activity_alert
    AFTER INSERT ON discord_alerts_log
    FOR EACH ROW
    EXECUTE FUNCTION update_guild_activity()
  `);

  // Discord analytics views
  await knex.raw(`
    CREATE OR REPLACE VIEW discord_command_stats AS
    SELECT 
      guild_id,
      command_name,
      COUNT(*) as usage_count,
      AVG(response_time_ms) as avg_response_time,
      COUNT(*) FILTER (WHERE success = true) as success_count,
      COUNT(*) FILTER (WHERE success = false) as error_count,
      DATE_TRUNC('day', MAX(time)) as last_used
    FROM discord_commands_usage 
    WHERE time >= NOW() - INTERVAL '30 days'
    GROUP BY guild_id, command_name
    ORDER BY usage_count DESC
  `);

  await knex.raw(`
    CREATE OR REPLACE VIEW discord_alert_stats AS
    SELECT 
      guild_id,
      alert_type,
      severity,
      COUNT(*) as alert_count,
      COUNT(*) FILTER (WHERE delivered = true) as delivered_count,
      COUNT(*) FILTER (WHERE delivered = false) as failed_count,
      DATE_TRUNC('day', MAX(time)) as last_alert
    FROM discord_alerts_log 
    WHERE time >= NOW() - INTERVAL '30 days'
    GROUP BY guild_id, alert_type, severity
    ORDER BY alert_count DESC
  `);

  await knex.raw(`
    CREATE OR REPLACE VIEW discord_guild_overview AS
    SELECT 
      g.guild_id,
      g.guild_name,
      g.alerts_enabled,
      g.last_activity,
      COUNT(DISTINCT s.id) as active_subscriptions,
      COALESCE(cmd_stats.total_commands, 0) as total_commands,
      COALESCE(alert_stats.total_alerts, 0) as total_alerts,
      COALESCE(alert_stats.delivered_alerts, 0) as delivered_alerts
    FROM discord_guild_settings g
    LEFT JOIN discord_subscriptions s ON g.guild_id = s.guild_id AND s.is_active = true
    LEFT JOIN (
      SELECT 
        guild_id,
        COUNT(*) as total_commands
      FROM discord_commands_usage 
      WHERE time >= NOW() - INTERVAL '30 days'
      GROUP BY guild_id
    ) cmd_stats ON g.guild_id = cmd_stats.guild_id
    LEFT JOIN (
      SELECT 
        guild_id,
        COUNT(*) as total_alerts,
        COUNT(*) FILTER (WHERE delivered = true) as delivered_alerts
      FROM discord_alerts_log 
      WHERE time >= NOW() - INTERVAL '30 days'
      GROUP BY guild_id
    ) alert_stats ON g.guild_id = alert_stats.guild_id
    GROUP BY g.guild_id, g.guild_name, g.alerts_enabled, g.last_activity, 
             cmd_stats.total_commands, alert_stats.total_alerts, alert_stats.delivered_alerts
    ORDER BY total_commands DESC, total_alerts DESC
  `);

  // Create function to cleanup old Discord logs
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_discord_logs(retention_days INTEGER DEFAULT 90)
    RETURNS TABLE(
      commands_deleted INTEGER,
      alerts_deleted INTEGER
    ) AS $$
    DECLARE
      cmd_count INTEGER;
      alert_count INTEGER;
    BEGIN
      -- Cleanup old command usage logs
      DELETE FROM discord_commands_usage 
      WHERE time < NOW() - INTERVAL '1 day' * retention_days;
      GET DIAGNOSTICS cmd_count = ROW_COUNT;
      
      -- Cleanup old alert logs
      DELETE FROM discord_alerts_log 
      WHERE time < NOW() - INTERVAL '1 day' * retention_days;
      GET DIAGNOSTICS alert_count = ROW_COUNT;
      
      RETURN QUERY SELECT cmd_count, alert_count;
    END;
    $$ LANGUAGE plpgsql
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop views
  await knex.raw("DROP VIEW IF EXISTS discord_guild_overview");
  await knex.raw("DROP VIEW IF EXISTS discord_alert_stats");
  await knex.raw("DROP VIEW IF EXISTS discord_command_stats");

  // Drop triggers and functions
  await knex.raw("DROP TRIGGER IF EXISTS trigger_update_guild_activity_alert ON discord_alerts_log");
  await knex.raw("DROP TRIGGER IF EXISTS trigger_update_guild_activity_command ON discord_commands_usage");
  await knex.raw("DROP FUNCTION IF EXISTS update_guild_activity()");
  await knex.raw("DROP FUNCTION IF EXISTS log_discord_alert(...)");
  await knex.raw("DROP FUNCTION IF EXISTS log_discord_command_usage(...)");
  await knex.raw("DROP FUNCTION IF EXISTS cleanup_discord_logs(INTEGER)");

  // Drop tables
  await knex.schema.dropTableIfExists("discord_guild_settings");
  await knex.schema.dropTableIfExists("discord_commands_usage");
  await knex.schema.dropTableIfExists("discord_alerts_log");
  await knex.schema.dropTableIfExists("discord_subscriptions");
}
