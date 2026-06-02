import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("user_sessions", (table) => {
    table.string("id", 64).primary();
    table.string("user_id", 255).notNullable().index();
    table.string("token_hash", 128).notNullable().unique();
    table.string("device_id", 128).nullable();
    table.string("device_name", 255).nullable();
    table.string("device_type", 64).nullable();
    table.string("user_agent", 512).nullable();
    table.string("ip_address", 64).nullable();
    table.string("status", 32).notNullable().defaultTo("active");
    table.timestamp("expires_at").notNullable();
    table.timestamp("last_active_at").notNullable();
    table.timestamp("revoked_at").nullable();
    table.string("revoked_reason", 255).nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["user_id", "status"]);
    table.index("expires_at");
  });

  await knex.schema.createTable("session_audit_log", (table) => {
    table.increments("id").primary();
    table.string("session_id", 64).notNullable().index();
    table.string("user_id", 255).notNullable().index();
    table.string("action", 64).notNullable();
    table.string("actor", 255).nullable();
    table.string("ip_address", 64).nullable();
    table.jsonb("metadata").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("session_audit_log");
  await knex.schema.dropTableIfExists("user_sessions");
}
