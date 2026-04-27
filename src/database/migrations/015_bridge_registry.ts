import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("bridge_registry", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("bridge_id").notNullable().unique();
    table.string("name").notNullable();
    table.string("display_name").notNullable();
    table.specificType("supported_chains", "text[]").notNullable().defaultTo("{}");
    table.string("owner_name").nullable();
    table.string("owner_contact").nullable();
    table.string("owner_url").nullable();
    table.string("status").notNullable().defaultTo("active");
    table.boolean("manual_override").notNullable().defaultTo(false);
    table.string("override_reason").nullable();
    table.jsonb("validation_rules").notNullable().defaultTo("{}");
    table.text("description").nullable();
    table.string("homepage_url").nullable();
    table.string("documentation_url").nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("bridge_registry_history", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("registry_id").notNullable().references("id").inTable("bridge_registry").onDelete("CASCADE");
    table.string("bridge_id").notNullable();
    table.string("changed_field").notNullable();
    table.text("old_value").nullable();
    table.text("new_value").nullable();
    table.string("changed_by").nullable();
    table.text("change_reason").nullable();
    table.timestamp("changed_at").notNullable().defaultTo(knex.fn.now());
    table.index(["registry_id", "changed_at"]);
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS bridge_registry_status_idx ON bridge_registry (status)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("bridge_registry_history");
  await knex.schema.dropTableIfExists("bridge_registry");
}
