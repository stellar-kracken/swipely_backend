import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Search analytics table (hypertable for time-series data)
  await knex.schema.createTable("search_analytics", (table) => {
    table.timestamp("time").notNullable().defaultTo(knex.fn.now());
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("query").notNullable();
    table.string("user_id").nullable();
    table.integer("results_count").nullable();
    table.string("clicked_result").nullable();
    table.json("filters").nullable();
    table.string("user_agent").nullable();
    table.string("ip_address").nullable();
    
    // Indexes for performance
    table.index(["query", "time"]);
    table.index("user_id");
    table.index("time");
    table.index("clicked_result");
  });

  // Convert search_analytics to TimescaleDB hypertable
  await knex.raw(
    "SELECT create_hypertable('search_analytics', 'time', if_not_exists => TRUE)"
  );

  // Search suggestions cache table
  await knex.schema.createTable("search_suggestions", (table) => {
    table.string("text").primary();
    table.string("type").notNullable();
    table.integer("count").defaultTo(1);
    table.timestamp("last_used").notNullable().defaultTo(knex.fn.now());
    table.json("metadata").nullable();
    
    // Indexes
    table.index("type");
    table.index("count");
    table.index("last_used");
  });

  // Popular searches aggregation table
  await knex.schema.createTable("popular_searches", (table) => {
    table.string("query").primary();
    table.integer("search_count").notNullable().defaultTo(0);
    table.integer("unique_users").defaultTo(0);
    table.decimal("avg_results", 10, 2).defaultTo(0);
    table.timestamp("last_searched").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    
    // Indexes
    table.index("search_count");
    table.index("last_searched");
    table.index("updated_at");
  });

  // Search index metadata table
  await knex.schema.createTable("search_index_metadata", (table) => {
    table.string("entity_type").primary();
    table.timestamp("last_indexed").notNullable().defaultTo(knex.fn.now());
    table.integer("total_records").defaultTo(0);
    table.integer("indexed_records").defaultTo(0);
    table.string("status").defaultTo("pending");
    table.json("index_config").nullable();
    table.text("error_message").nullable();
    
    // Indexes
    table.index("last_indexed");
    table.index("status");
  });

  // Insert initial index metadata
  await knex("search_index_metadata").insert([
    {
      entity_type: "asset",
      status: "pending",
      index_config: { fields: ["symbol", "name", "bridge_provider"] },
    },
    {
      entity_type: "bridge", 
      status: "pending",
      index_config: { fields: ["name", "source_chain"] },
    },
    {
      entity_type: "pool",
      status: "pending", 
      index_config: { fields: ["asset_a", "asset_b", "dex"] },
    },
    {
      entity_type: "documentation",
      status: "pending",
      index_config: { fields: ["title", "content", "category"] },
    },
  ]);

  // Create full-text search indexes for assets
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_assets_search ON assets 
    USING gin(to_tsvector('english', symbol || ' ' || name || ' ' || COALESCE(bridge_provider, '')))
  `);

  // Create full-text search indexes for bridges
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_bridges_search ON bridges 
    USING gin(to_tsvector('english', name || ' ' || source_chain))
  `);

  // Create full-text search indexes for liquidity pools
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_liquidity_pools_search ON liquidity_pools 
    USING gin(to_tsvector('english', asset_a || ' ' || asset_b || ' ' || dex))
  `);

  // Create function to update popular searches
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_popular_searches()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO popular_searches (query, search_count, unique_users, avg_results, last_searched, updated_at)
      VALUES (NEW.query, 1, 
              CASE WHEN NEW.user_id IS NOT NULL THEN 1 ELSE 0 END,
              COALESCE(NEW.results_count, 0),
              NEW.time,
              NEW.time)
      ON CONFLICT (query) 
      DO UPDATE SET 
        search_count = popular_searches.search_count + 1,
        unique_users = popular_searches.unique_users + 
                       CASE WHEN NEW.user_id IS NOT NULL AND 
                            NOT EXISTS (SELECT 1 FROM search_analytics sa2 
                                       WHERE sa2.query = NEW.query AND sa2.user_id = NEW.user_id 
                                       AND sa2.time < NEW.time) 
                            THEN 1 ELSE 0 END,
        avg_results = (popular_searches.avg_results * popular_searches.search_count + 
                       COALESCE(NEW.results_count, 0)) / (popular_searches.search_count + 1),
        last_searched = NEW.time,
        updated_at = NEW.time;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  // Create trigger to automatically update popular searches
  await knex.raw(`
    CREATE TRIGGER trigger_update_popular_searches
    AFTER INSERT ON search_analytics
    FOR EACH ROW
    EXECUTE FUNCTION update_popular_searches()
  `);

  // Create function to clean up old search analytics
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_old_search_analytics(retention_days INTEGER DEFAULT 90)
    RETURNS INTEGER AS $$
    DECLARE
      deleted_count INTEGER;
    BEGIN
      DELETE FROM search_analytics 
      WHERE time < NOW() - INTERVAL '1 day' * retention_days;
      
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      
      -- Log the cleanup
      INSERT INTO search_index_metadata (entity_type, status, last_indexed, error_message)
      VALUES ('cleanup', 'completed', NOW(), 'Deleted ' || deleted_count || ' old search records')
      ON CONFLICT (entity_type) DO UPDATE SET
        status = EXCLUDED.status,
        last_indexed = EXCLUDED.last_indexed,
        error_message = EXCLUDED.error_message;
      
      RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop triggers and functions
  await knex.raw("DROP TRIGGER IF EXISTS trigger_update_popular_searches ON search_analytics");
  await knex.raw("DROP FUNCTION IF EXISTS update_popular_searches()");
  await knex.raw("DROP FUNCTION IF EXISTS cleanup_old_search_analytics(INTEGER)");

  // Drop indexes
  await knex.raw("DROP INDEX IF EXISTS idx_assets_search");
  await knex.raw("DROP INDEX IF EXISTS idx_bridges_search");
  await knex.raw("DROP INDEX IF EXISTS idx_liquidity_pools_search");

  // Drop tables
  await knex.schema.dropTableIfExists("search_index_metadata");
  await knex.schema.dropTableIfExists("popular_searches");
  await knex.schema.dropTableIfExists("search_suggestions");
  await knex.schema.dropTableIfExists("search_analytics");
}
