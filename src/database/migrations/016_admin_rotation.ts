import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Create admin_accounts table for managing system administrators
  await knex.schema.createTable("admin_accounts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("address").notNullable().unique();
    table.string("name").notNullable();
    table.string("email").nullable();
    table.jsonb("roles").notNullable().defaultTo("[]"); // e.g., ["super_admin", "operator", "auditor"]
    table.boolean("is_active").notNullable().defaultTo(true);
    table.string("added_by").notNullable(); // Address of admin who added this account
    table.timestamp("activated_at").nullable();
    table.timestamp("deactivated_at").nullable();
    table.string("deactivated_by").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["address"]);
    table.index(["is_active"]);
  });

  // Create admin_rotation_events table for audit trail
  await knex.schema.createTable("admin_rotation_events", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("event_type").notNullable(); // added | removed | activated | deactivated | role_changed
    table.string("admin_address").notNullable();
    table.string("actor_address").notNullable(); // Who performed the action
    table.jsonb("before_state").nullable();
    table.jsonb("after_state").nullable();
    table.text("reason").nullable();
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["admin_address"]);
    table.index(["event_type"]);
    table.index(["created_at"]);
  });

  // Create admin_rotation_proposals table for multi-sig rotation workflows
  await knex.schema.createTable("admin_rotation_proposals", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("proposal_type").notNullable(); // add_admin | remove_admin | change_roles
    table.string("target_address").notNullable();
    table.string("proposed_by").notNullable();
    table.jsonb("proposed_changes").notNullable();
    table.string("status").notNullable().defaultTo("pending"); // pending | approved | rejected | executed | expired
    table.jsonb("approvals").notNullable().defaultTo("[]"); // Array of approver addresses
    table.integer("required_approvals").notNullable().defaultTo(2);
    table.timestamp("expires_at").notNullable();
    table.timestamp("executed_at").nullable();
    table.string("executed_by").nullable();
    table.text("rejection_reason").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["status"]);
    table.index(["target_address"]);
    table.index(["expires_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("admin_rotation_proposals");
  await knex.schema.dropTableIfExists("admin_rotation_events");
  await knex.schema.dropTableIfExists("admin_accounts");
}
