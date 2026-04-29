import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Store baseline schemas for upstream sources
  await knex.schema.createTable("schema_baselines", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("source_name").notNullable().unique();
    table.jsonb("schema_definition").notNullable();
    table.integer("version").notNullable().defaultTo(1);
    table.timestamps(true, true);
  });

  // Store detected schema drift incidents
  await knex.schema.createTable("schema_drift_incidents", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("source_name").notNullable();
    table.string("drift_type").notNullable(); // ADDITION, REMOVAL, TYPE_CHANGE
    table.string("field_path").notNullable();
    table.string("expected_type").nullable();
    table.string("actual_type").nullable();
    table.jsonb("raw_payload_sample").nullable();
    table.boolean("is_breaking").notNullable().defaultTo(false);
    table.boolean("is_resolved").notNullable().defaultTo(false);
    table.timestamp("detected_at").notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);

    table.index(["source_name", "detected_at"]);
    table.index(["is_resolved", "drift_type"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("schema_drift_incidents");
  await knex.schema.dropTableIfExists("schema_baselines");
}
