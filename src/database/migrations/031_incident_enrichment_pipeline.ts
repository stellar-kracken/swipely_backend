import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("bridge_incidents", (table) => {
    table.jsonb("enrichment_metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.specificType("enrichment_tags", "text[]").notNullable().defaultTo(knex.raw("'{}'::text[]"));
    table.jsonb("derived_fields").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.jsonb("enrichment_validation").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
  });

  await knex.schema.alterTable("bridge_incident_review_queue", (table) => {
    table.jsonb("enriched_payload").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
  });

  await knex.schema.alterTable("bridge_incident_ingestion_history", (table) => {
    table.jsonb("enrichment_metadata").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.specificType("enrichment_tags", "text[]").notNullable().defaultTo(knex.raw("'{}'::text[]"));
    table.jsonb("derived_fields").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
  });

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS bridge_incidents_enrichment_tags_idx
    ON bridge_incidents USING GIN (enrichment_tags)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw("DROP INDEX IF EXISTS bridge_incidents_enrichment_tags_idx");

  await knex.schema.alterTable("bridge_incident_ingestion_history", (table) => {
    table.dropColumn("enrichment_metadata");
    table.dropColumn("enrichment_tags");
    table.dropColumn("derived_fields");
  });

  await knex.schema.alterTable("bridge_incident_review_queue", (table) => {
    table.dropColumn("enriched_payload");
  });

  await knex.schema.alterTable("bridge_incidents", (table) => {
    table.dropColumn("enrichment_metadata");
    table.dropColumn("enrichment_tags");
    table.dropColumn("derived_fields");
    table.dropColumn("enrichment_validation");
  });
}
