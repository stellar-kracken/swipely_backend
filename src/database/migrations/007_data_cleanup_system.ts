import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Cleanup metrics table (hypertable for time-series data)
  await knex.schema.createTable("cleanup_metrics", (table) => {
    table.timestamp("time").notNullable().defaultTo(knex.fn.now());
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.integer("total_records_processed").notNullable().defaultTo(0);
    table.integer("total_records_archived").notNullable().defaultTo(0);
    table.integer("total_records_deleted").notNullable().defaultTo(0);
    table.bigInteger("storage_saved").notNullable().defaultTo(0);
    table.integer("duration").notNullable().defaultTo(0);
    table.json("reports").notNullable();
    table.string("trigger_type").notNullable(); // scheduled, manual
    table.string("triggered_by").nullable();
    
    // Indexes
    table.index("time");
    table.index("trigger_type");
  });

  // Convert cleanup_metrics to TimescaleDB hypertable
  await knex.raw(
    "SELECT create_hypertable('cleanup_metrics', 'time', if_not_exists => TRUE)"
  );

  // Retention policies table
  await knex.schema.createTable("retention_policies", (table) => {
    table.string("entity_type").primary();
    table.string("table_name").notNullable();
    table.integer("retention_days").notNullable();
    table.boolean("archive_before_delete").defaultTo(true);
    table.json("critical_data_points").nullable();
    table.text("preserve_condition").nullable();
    table.boolean("is_active").defaultTo(true);
    table.timestamps(true, true);
    
    // Indexes
    table.index("is_active");
    table.index("retention_days");
  });

  // Insert default retention policies
  await knex("retention_policies").insert([
    {
      entity_type: "prices",
      table_name: "prices",
      retention_days: 90,
      archive_before_delete: true,
      critical_data_points: JSON.stringify(["time", "symbol", "source"]),
      preserve_condition: "time > NOW() - INTERVAL '7 days'",
    },
    {
      entity_type: "health_scores",
      table_name: "health_scores",
      retention_days: 180,
      archive_before_delete: true,
      critical_data_points: JSON.stringify(["time", "symbol", "overall_score"]),
      preserve_condition: "time > NOW() - INTERVAL '30 days'",
    },
    {
      entity_type: "pool_events",
      table_name: "pool_events",
      retention_days: 60,
      archive_before_delete: true,
      critical_data_points: JSON.stringify(["time", "pool_id", "type"]),
      preserve_condition: "type IN ('deposit', 'withdraw') AND time > NOW() - INTERVAL '14 days'",
    },
    {
      entity_type: "pool_metrics",
      table_name: "pool_metrics",
      retention_days: 120,
      archive_before_delete: true,
      critical_data_points: JSON.stringify(["time", "pool_id", "tvl"]),
      preserve_condition: "time > NOW() - INTERVAL '30 days'",
    },
    {
      entity_type: "search_analytics",
      table_name: "search_analytics",
      retention_days: 90,
      archive_before_delete: false,
      critical_data_points: JSON.stringify(["time", "query"]),
      preserve_condition: null,
    },
  ]);

  // Archive table metadata
  await knex.schema.createTable("archive_metadata", (table) => {
    table.string("table_name").primary();
    table.timestamp("last_archived").nullable();
    table.integer("total_archived").defaultTo(0);
    table.bigInteger("archive_size_bytes").defaultTo(0);
    table.string("compression_type").defaultTo("none");
    table.string("location").defaultTo("database");
    table.boolean("is_enabled").defaultTo(true);
    table.timestamps(true, true);
    
    // Indexes
    table.index("last_archived");
    table.index("is_enabled");
  });

  // Create function to get table size
  await knex.raw(`
    CREATE OR REPLACE FUNCTION get_table_size(table_name TEXT)
    RETURNS BIGINT AS $$
    DECLARE
      size_bytes BIGINT;
    BEGIN
      EXECUTE format('SELECT pg_total_relation_size(%L)', table_name) INTO size_bytes;
      RETURN size_bytes;
    END;
    $$ LANGUAGE plpgsql
  `);

  // Create function to estimate cleanup impact
  await knex.raw(`
    CREATE OR REPLACE FUNCTION estimate_cleanup_impact(p_table_name TEXT, p_retention_days INTEGER)
    RETURNS TABLE(
      total_records BIGINT,
      records_to_delete BIGINT,
      estimated_size_to_free BIGINT,
      cutoff_date TIMESTAMP
    ) AS $$
    DECLARE
      v_total_records BIGINT;
      v_records_to_delete BIGINT;
      v_sql TEXT;
    BEGIN
      -- Build dynamic SQL to count from the specified table
      v_sql := format('SELECT COUNT(*) FROM %I', p_table_name);
      EXECUTE v_sql INTO v_total_records;
      
      -- Build dynamic SQL to count records to delete
      v_sql := format('SELECT COUNT(*) FROM %I WHERE time < NOW() - INTERVAL ''1 day'' * $1', p_table_name);
      EXECUTE v_sql INTO v_records_to_delete USING p_retention_days;
      
      RETURN QUERY SELECT 
        v_total_records as total_records,
        v_records_to_delete as records_to_delete,
        (v_records_to_delete * 1024) as estimated_size_to_free,
        (NOW() - INTERVAL '1 day' * p_retention_days) as cutoff_date;
    END;
    $$ LANGUAGE plpgsql
  `);

  // Create trigger to automatically update archive metadata
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_archive_metadata()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE archive_metadata 
      SET 
        last_archived = NOW(),
        total_archived = total_archived + 1,
        archive_size_bytes = get_table_size(TG_TABLE_NAME || '_archive')
      WHERE table_name = TG_TABLE_NAME;
      
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  // Storage monitoring view
  await knex.raw(`
    CREATE OR REPLACE VIEW storage_monitoring AS
    SELECT 
      schemaname,
      tablename,
      pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
      pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
      pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size,
      pg_total_relation_size(schemaname||'.'||tablename) as total_size_bytes,
      pg_relation_size(schemaname||'.'||tablename) as table_size_bytes,
      (pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size_bytes
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
  `);

  // Cleanup statistics view
  await knex.raw(`
    CREATE OR REPLACE VIEW cleanup_statistics AS
    SELECT 
      DATE_TRUNC('day', time) as cleanup_date,
      SUM(total_records_processed) as daily_records_processed,
      SUM(total_records_archived) as daily_records_archived,
      SUM(total_records_deleted) as daily_records_deleted,
      SUM(storage_saved) as daily_storage_saved,
      AVG(duration) as avg_duration,
      COUNT(*) as cleanup_runs
    FROM cleanup_metrics 
    WHERE time >= NOW() - INTERVAL '30 days'
    GROUP BY DATE_TRUNC('day', time)
    ORDER BY cleanup_date DESC
  `);

  // Create function to cleanup old archive data
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_archive_data(archive_retention_days INTEGER DEFAULT 365)
    RETURNS INTEGER AS $$
    DECLARE
      tables_to_clean TEXT[];
      table_name TEXT;
      deleted_count INTEGER := 0;
      total_deleted INTEGER := 0;
    BEGIN
      -- Get all archive tables
      SELECT array_agg(table_name) INTO tables_to_clean
      FROM information_schema.tables 
      WHERE table_name LIKE '%_archive' 
        AND table_schema = 'public';
      
      -- Clean each archive table
      FOREACH table_name IN ARRAY tables_to_clean
      LOOP
        EXECUTE format('DELETE FROM %I WHERE time < NOW() - INTERVAL ''1 day'' * %L', table_name, archive_retention_days);
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        total_deleted := total_deleted + deleted_count;
        
        -- Log the cleanup
        INSERT INTO cleanup_metrics (total_records_deleted, duration, reports, trigger_type, time)
        VALUES (deleted_count, 0, json_build_object('table', table_name, 'type', 'archive_cleanup'), 'archive_cleanup', NOW());
      END LOOP;
      
      RETURN total_deleted;
    END;
    $$ LANGUAGE plpgsql
  `);

  // Create index for better cleanup performance
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_prices_time_cleanup ON prices (time DESC) WHERE time < NOW() - INTERVAL '7 days'
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_health_scores_time_cleanup ON health_scores (time DESC) WHERE time < NOW() - INTERVAL '30 days'
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_pool_events_time_cleanup ON pool_events (time DESC) WHERE time < NOW() - INTERVAL '14 days'
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_pool_metrics_time_cleanup ON pool_metrics (time DESC) WHERE time < NOW() - INTERVAL '30 days'
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_search_analytics_time_cleanup ON search_analytics (time DESC) WHERE time < NOW() - INTERVAL '7 days'
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop views
  await knex.raw("DROP VIEW IF EXISTS cleanup_statistics");
  await knex.raw("DROP VIEW IF EXISTS storage_monitoring");

  // Drop functions
  await knex.raw("DROP FUNCTION IF EXISTS cleanup_archive_data(INTEGER)");
  await knex.raw("DROP FUNCTION IF EXISTS update_archive_metadata()");
  await knex.raw("DROP FUNCTION IF EXISTS estimate_cleanup_impact(TEXT, INTEGER)");
  await knex.raw("DROP FUNCTION IF EXISTS get_table_size(TEXT)");

  // Drop indexes
  await knex.raw("DROP INDEX IF EXISTS idx_prices_time_cleanup");
  await knex.raw("DROP INDEX IF EXISTS idx_health_scores_time_cleanup");
  await knex.raw("DROP INDEX IF EXISTS idx_pool_events_time_cleanup");
  await knex.raw("DROP INDEX IF EXISTS idx_pool_metrics_time_cleanup");
  await knex.raw("DROP INDEX IF EXISTS idx_search_analytics_time_cleanup");

  // Drop tables
  await knex.schema.dropTableIfExists("archive_metadata");
  await knex.schema.dropTableIfExists("retention_policies");
  await knex.schema.dropTableIfExists("cleanup_metrics");

  // Drop archive tables if they exist
  const archiveTables = await knex.raw(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_name LIKE '%_archive' 
      AND table_schema = 'public'
  `);

  for (const table of archiveTables.rows) {
    await knex.schema.dropTableIfExists(table.table_name);
  }
}
