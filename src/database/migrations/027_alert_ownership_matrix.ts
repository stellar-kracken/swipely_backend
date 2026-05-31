import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Alert ownership table
  await knex.schema.createTable("alert_ownership", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("alert_id").notNullable().unique();
    table.string("owner_type").notNullable(); // 'user' or 'team'
    table.string("owner_id").notNullable(); // user wallet address or team identifier
    table.string("created_by").notNullable(); // actor who assigned ownership
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    // Foreign key to alert_rules
    table.foreign("alert_id").references("id").inTable("alert_rules").onDelete("CASCADE");

    // Indexes for efficient queries
    table.index(["alert_id"]);
    table.index(["owner_id"]);
    table.index(["owner_type", "owner_id"]);
  });

  // Escalation contacts table
  await knex.schema.createTable("escalation_contacts", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("alert_id").notNullable();
    table.string("contact_user_id").notNullable(); // user identifier for escalation
    table.integer("order").notNullable(); // escalation sequence (1, 2, 3, ...)
    table.string("created_by").notNullable(); // actor who added contact
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    // Foreign key to alert_rules
    table.foreign("alert_id").references("id").inTable("alert_rules").onDelete("CASCADE");

    // Unique constraint: one contact per alert (can't add same contact twice)
    table.unique(["alert_id", "contact_user_id"]);

    // Index for efficient ordering queries
    table.index(["alert_id", "order"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("escalation_contacts");
  await knex.schema.dropTableIfExists("alert_ownership");
}
