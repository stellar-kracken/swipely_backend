import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("bridge_incidents", (table) => {
    table.string("source_type").nullable();
    table.string("source_external_id").nullable();
    table.string("source_repository").nullable();
    table.string("source_repo_avatar_url").nullable();
    table.string("source_actor").nullable();
    table.string("normalized_fingerprint").nullable();
    table.boolean("requires_manual_review").notNullable().defaultTo(false);
    table.integer("ingestion_attempt_count").notNullable().defaultTo(0);
    table.text("last_ingestion_error").nullable();
    table.jsonb("source_attribution").notNullable().defaultTo("{}");
  });

  await knex.schema.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bridge_incidents_normalized_fingerprint_unique
    ON bridge_incidents (normalized_fingerprint)
    WHERE normalized_fingerprint IS NOT NULL
  `);

  await knex.schema.createTable("bridge_incident_ingestion_history", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("incident_id").nullable().references("id").inTable("bridge_incidents").onDelete("SET NULL");
    table.string("source_type").notNullable();
    table.string("source_external_id").nullable();
    table.string("event_type").notNullable();
    table.jsonb("payload").notNullable().defaultTo("{}");
    table.string("status").notNullable().defaultTo("processed");
    table.text("error_message").nullable();
    table.integer("attempt_number").notNullable().defaultTo(1);
    table.timestamps(true, true);

    table.index(["incident_id", "created_at"]);
    table.index(["source_type", "source_external_id"]);
  });

  await knex.schema.createTable("bridge_incident_review_queue", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("source_type").notNullable();
    table.string("source_external_id").nullable();
    table.jsonb("raw_payload").notNullable();
    table.string("reason").notNullable();
    table.string("status").notNullable().defaultTo("pending"); // pending | approved | rejected
    table.uuid("incident_id").nullable().references("id").inTable("bridge_incidents").onDelete("SET NULL");
    table.timestamp("resolved_at").nullable();
    table.timestamps(true, true);

    table.index(["status", "created_at"]);
    table.index(["source_type", "source_external_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("bridge_incident_review_queue");
  await knex.schema.dropTableIfExists("bridge_incident_ingestion_history");

  await knex.schema.raw("DROP INDEX IF EXISTS bridge_incidents_normalized_fingerprint_unique");

  await knex.schema.alterTable("bridge_incidents", (table) => {
    table.dropColumn("source_type");
    table.dropColumn("source_external_id");
    table.dropColumn("source_repository");
    table.dropColumn("source_repo_avatar_url");
    table.dropColumn("source_actor");
    table.dropColumn("normalized_fingerprint");
    table.dropColumn("requires_manual_review");
    table.dropColumn("ingestion_attempt_count");
    table.dropColumn("last_ingestion_error");
    table.dropColumn("source_attribution");
  });
}
