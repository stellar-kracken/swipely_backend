import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Circuit breaker triggers table
  await knex.schema.createTable("circuit_breaker_triggers", (table) => {
    table.string("id").primary();
    table.string("alert_id").notNullable();
    table.string("alert_type").notNullable();
    table.string("asset_code");
    table.string("bridge_id");
    table.enum("severity", ["low", "medium", "high"]).notNullable();
    table.decimal("value", 20, 8).notNullable();
    table.decimal("threshold", 20, 8).notNullable();
    table.integer("pause_scope").notNullable(); // 0=global, 1=bridge, 2=asset
    table.integer("pause_level").notNullable(); // 0=none, 1=warning, 2=partial, 3=full
    table.text("reason").notNullable();
    table.timestamp("triggered_at").defaultTo(knex.fn.now());
    table.enum("status", ["triggered", "resolved", "expired"]).defaultTo("triggered");
    table.timestamp("resolved_at");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());

    table.index(["alert_type", "asset_code"]);
    table.index(["bridge_id"]);
    table.index(["status"]);
    table.index(["triggered_at"]);
  });

  // Circuit breaker pause states table (for tracking active pauses)
  await knex.schema.createTable("circuit_breaker_pauses", (table) => {
    table.integer("pause_id").primary();
    table.integer("pause_scope").notNullable();
    table.string("identifier"); // bridge_id or asset_code
    table.integer("pause_level").notNullable();
    table.string("triggered_by").notNullable();
    table.text("trigger_reason").notNullable();
    table.bigInteger("timestamp").notNullable();
    table.bigInteger("recovery_deadline").notNullable();
    table.integer("guardian_approvals").defaultTo(0);
    table.integer("guardian_threshold").notNullable();
    table.enum("status", ["active", "recovering", "resolved"]).defaultTo("active");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());

    table.index(["pause_scope", "identifier"]);
    table.index(["status"]);
    table.index(["recovery_deadline"]);
  });

  // Circuit breaker recovery requests
  await knex.schema.createTable("circuit_breaker_recovery_requests", (table) => {
    table.increments("id").primary();
    table.integer("pause_id").notNullable().references("pause_id").inTable("circuit_breaker_pauses");
    table.string("requested_by").notNullable();
    table.bigInteger("timestamp").notNullable();
    table.integer("approvals").defaultTo(0);
    table.integer("threshold").notNullable();
    table.enum("status", ["pending", "approved", "executed", "rejected"]).defaultTo("pending");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());

    table.index(["pause_id"]);
    table.index(["status"]);
  });

  // Circuit breaker whitelist
  await knex.schema.createTable("circuit_breaker_whitelist", (table) => {
    table.increments("id").primary();
    table.enum("type", ["address", "asset", "bridge"]).notNullable();
    table.string("value").notNullable();
    table.string("added_by").notNullable();
    table.timestamp("added_at").defaultTo(knex.fn.now());

    table.unique(["type", "value"]);
    table.index(["type"]);
  });

  // Circuit breaker configuration (for trigger configs)
  await knex.schema.createTable("circuit_breaker_configs", (table) => {
    table.increments("id").primary();
    table.integer("alert_type").notNullable();
    table.decimal("threshold", 20, 8).notNullable();
    table.integer("pause_level").notNullable();
    table.bigInteger("cooldown_period").notNullable();
    table.bigInteger("last_trigger").defaultTo(0);
    table.boolean("enabled").defaultTo(true);
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());

    table.unique(["alert_type"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("circuit_breaker_recovery_requests");
  await knex.schema.dropTableIfExists("circuit_breaker_pauses");
  await knex.schema.dropTableIfExists("circuit_breaker_triggers");
  await knex.schema.dropTableIfExists("circuit_breaker_whitelist");
  await knex.schema.dropTableIfExists("circuit_breaker_configs");
}