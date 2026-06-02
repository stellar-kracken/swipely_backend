import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Groups for correlated incidents
  await knex.schema.createTable("incident_correlation_groups", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("created_by").notNullable().defaultTo("system");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("incident_correlation_members", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("group_id").notNullable().references("id").inTable("incident_correlation_groups").onDelete("CASCADE");
    table.uuid("incident_id").notNullable().references("id").inTable("bridge_incidents").onDelete("CASCADE");
    table.string("linked_by").notNullable().defaultTo("system");
    table.timestamp("linked_at").notNullable().defaultTo(knex.fn.now());
    table.index(["group_id"]);
    table.index(["incident_id"]);
  });

  await knex.schema.createTable("incident_correlation_audit", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("action").notNullable(); // suggested | linked | unlinked | approved
    table.uuid("group_id").nullable().references("id").inTable("incident_correlation_groups").onDelete("SET NULL");
    table.uuid("incident_id").nullable().references("id").inTable("bridge_incidents").onDelete("SET NULL");
    table.uuid("target_incident_id").nullable().references("id").inTable("bridge_incidents").onDelete("SET NULL");
    table.string("actor").notNullable().defaultTo("system");
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["incident_id", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("incident_correlation_audit");
  await knex.schema.dropTableIfExists("incident_correlation_members");
  await knex.schema.dropTableIfExists("incident_correlation_groups");
}
