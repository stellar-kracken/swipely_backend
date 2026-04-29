import { Knex } from "knex";

/**
 * Migration: Configuration Service with Full Audit Trail
 * Issue: #377
 * 
 * Creates:
 * - configs: Core configuration storage with hierarchical resolution
 * - config_audits: Immutable append-only audit log for all changes
 */

export async function up(knex: Knex): Promise<void> {
  // Core configuration table with hierarchical environment support
  await knex.schema.createTable("configs", (table) => {
    table.bigIncrements("id").primary();
    
    // Hierarchical environment support
    table.string("environment", 64).notNullable()
      .checkIn(["global", "dev", "staging", "prod-us-east", "prod-eu-west"]);
    
    // Configuration key
    table.string("key", 256).notNullable();
    
    // JSONB value storage for flexible data types
    table.jsonb("value").notNullable();
    
    // Encryption flag for sensitive values
    table.boolean("encrypted").defaultTo(false);
    
    // Validation schema identifier (references Zod schema)
    table.string("schema_name", 128);
    
    // Validation status
    table.boolean("validated").defaultTo(false);
    
    // Human-readable description
    table.text("description");
    
    // Audit metadata
    table.string("created_by", 128).notNullable();
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
    table.string("changed_by", 128);
    table.timestamp("changed_at", { useTz: true });
    
    // Unique constraint: one config per environment+key
    table.unique(["environment", "key"]);
    
    // Performance indexes
    table.index(["environment", "key"], "configs_env_key_idx");
    table.index(["environment", "changed_at"], "configs_env_changed_idx");
  });

  // Audit trail table for full change history
  await knex.schema.createTable("config_audits", (table) => {
    table.bigIncrements("id").primary();
    
    // Reference to config (cascade delete)
    table.bigInteger("config_id")
      .notNullable()
      .references("id")
      .inTable("configs")
      .onDelete("CASCADE");
    
    // Old and new values (JSONB for flexible comparison)
    table.jsonb("old_value");
    table.jsonb("new_value").notNullable();
    
    // Actor and reason
    table.string("changed_by", 128).notNullable();
    table.text("change_reason").notNullable();
    
    // Timestamp
    table.timestamp("changed_at", { useTz: true }).defaultTo(knex.fn.now());
    
    // Performance index
    table.index(["config_id"], "config_audits_config_idx");
    table.index(["changed_at"], "config_audits_changed_at_idx");
  });

  // Insert safe defaults for critical configurations
  await knex("configs").insert([
    {
      environment: "global",
      key: "MAX_RETRIES",
      value: JSON.stringify(3),
      encrypted: false,
      schema_name: "MAX_RETRIES",
      validated: true,
      description: "Maximum retry attempts for failed operations",
      created_by: "system",
    },
    {
      environment: "global",
      key: "LOG_LEVEL",
      value: JSON.stringify("info"),
      encrypted: false,
      schema_name: "LOG_LEVEL",
      validated: true,
      description: "Default logging level",
      created_by: "system",
    },
    {
      environment: "global",
      key: "RATE_LIMIT_MAX",
      value: JSON.stringify(100),
      encrypted: false,
      schema_name: "RATE_LIMIT_MAX",
      validated: true,
      description: "Default rate limit maximum requests",
      created_by: "system",
    },
    {
      environment: "global",
      key: "PRICE_DEVIATION_THRESHOLD",
      value: JSON.stringify(0.02),
      encrypted: false,
      schema_name: "PRICE_DEVIATION_THRESHOLD",
      validated: true,
      description: "Price deviation alert threshold (2%)",
      created_by: "system",
    },
    {
      environment: "global",
      key: "BRIDGE_SUPPLY_MISMATCH_THRESHOLD",
      value: JSON.stringify(0.1),
      encrypted: false,
      schema_name: "BRIDGE_SUPPLY_MISMATCH_THRESHOLD",
      validated: true,
      description: "Bridge supply mismatch alert threshold (10%)",
      created_by: "system",
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order (audit first due to foreign key)
  await knex.schema.dropTableIfExists("config_audits");
  await knex.schema.dropTableIfExists("configs");
}
