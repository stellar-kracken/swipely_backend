import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Liquidity pools table
  await knex.schema.createTable("liquidity_pools", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("asset_a").notNullable();
    table.string("asset_b").notNullable();
    table.string("dex").notNullable();
    table.string("contract_address").nullable();
    table.decimal("total_liquidity", 20, 2).notNullable().defaultTo(0);
    table.decimal("reserve_a", 20, 8).notNullable().defaultTo(0);
    table.decimal("reserve_b", 20, 8).notNullable().defaultTo(0);
    table.decimal("fee", 8, 6).notNullable().defaultTo(0);
    table.decimal("apr", 8, 4).notNullable().defaultTo(0);
    table.decimal("volume_24h", 20, 2).notNullable().defaultTo(0);
    table.integer("health_score").notNullable().defaultTo(0);
    table.timestamp("last_updated").notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
    
    // Indexes for performance
    table.index(["asset_a", "asset_b"]);
    table.index("dex");
    table.index("health_score");
    table.index("total_liquidity");
  });

  // Pool events table (hypertable for time-series data)
  await knex.schema.createTable("pool_events", (table) => {
    table.timestamp("time").notNullable().defaultTo(knex.fn.now());
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("pool_id").notNullable();
    table.string("type").notNullable(); // deposit, withdraw, swap
    table.decimal("amount_a", 20, 8).notNullable();
    table.decimal("amount_b", 20, 8).notNullable();
    table.string("user").notNullable();
    table.string("tx_hash").notNullable();
    table.json("metadata").nullable();
    
    // Indexes
    table.index(["pool_id", "time"]);
    table.index("type");
    table.index("user");
    table.index("time");
  });

  // Convert pool_events to TimescaleDB hypertable
  await knex.raw(
    "SELECT create_hypertable('pool_events', 'time', if_not_exists => TRUE)"
  );

  // Pool metrics table (hypertable for historical data)
  await knex.schema.createTable("pool_metrics", (table) => {
    table.timestamp("time").notNullable().defaultTo(knex.fn.now());
    table.uuid("pool_id").notNullable();
    table.decimal("tvl", 20, 2).notNullable();
    table.decimal("volume_24h", 20, 2).notNullable();
    table.decimal("volume_7d", 20, 2).notNullable();
    table.decimal("apr", 8, 4).notNullable();
    table.decimal("fee", 8, 6).notNullable();
    table.decimal("utilization", 5, 4).notNullable();
    table.integer("health_score").notNullable();
    table.json("liquidity_depth").nullable();
    
    // Indexes
    table.index(["pool_id", "time"]);
    table.index("health_score");
    table.index("time");
  });

  // Convert pool_metrics to TimescaleDB hypertable
  await knex.raw(
    "SELECT create_hypertable('pool_metrics', 'time', if_not_exists => TRUE)"
  );

  // Pool alerts table
  await knex.schema.createTable("pool_alerts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("pool_id").notNullable();
    table.string("alert_type").notNullable(); // liquidity_change, health_drop, large_event
    table.string("severity").notNullable(); // low, medium, high, critical
    table.string("title").notNullable();
    table.text("description").notNullable();
    table.json("metadata").nullable();
    table.boolean("is_resolved").defaultTo(false);
    table.timestamp("resolved_at").nullable();
    table.timestamps(true, true);
    
    // Indexes
    table.index(["pool_id", "is_resolved"]);
    table.index("severity");
    table.index("alert_type");
    table.index("created_at");
  });

  // Add foreign key constraints
  await knex.schema.alterTable("pool_events", (table) => {
    table.foreign("pool_id").references("id").inTable("liquidity_pools").onDelete("CASCADE");
  });

  await knex.schema.alterTable("pool_metrics", (table) => {
    table.foreign("pool_id").references("id").inTable("liquidity_pools").onDelete("CASCADE");
  });

  await knex.schema.alterTable("pool_alerts", (table) => {
    table.foreign("pool_id").references("id").inTable("liquidity_pools").onDelete("CASCADE");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("pool_alerts");
  await knex.schema.dropTableIfExists("pool_metrics");
  await knex.schema.dropTableIfExists("pool_events");
  await knex.schema.dropTableIfExists("liquidity_pools");
}
