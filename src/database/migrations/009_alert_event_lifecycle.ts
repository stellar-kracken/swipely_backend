import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("alert_events", (table) => {
    table.uuid("event_id").defaultTo(knex.raw("gen_random_uuid()"));
    table
      .string("lifecycle_state")
      .notNullable()
      .defaultTo("open");
    table.timestamp("acknowledged_at").nullable();
    table.string("acknowledged_by").nullable();
    table.timestamp("assigned_at").nullable();
    table.string("assigned_to").nullable();
    table.timestamp("closed_at").nullable();
    table.string("closed_by").nullable();
    table.text("closure_note").nullable();
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    UPDATE alert_events
    SET event_id = gen_random_uuid()
    WHERE event_id IS NULL
  `);

  await knex.raw(`
    ALTER TABLE alert_events
    ALTER COLUMN event_id SET NOT NULL
  `);

  await knex.schema.alterTable("alert_events", (table) => {
    table.unique(["event_id"]);
    table.index(["lifecycle_state", "time"]);
  });

  await knex.schema.createTable("alert_event_audit", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("event_id").notNullable();
    table.uuid("rule_id").notNullable();
    table.string("action").notNullable();
    table.string("actor").notNullable();
    table.jsonb("details").notNullable().defaultTo("{}");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["event_id", "created_at"]);
    table.index(["rule_id", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alert_event_audit");

  await knex.schema.alterTable("alert_events", (table) => {
    table.dropIndex(["lifecycle_state", "time"]);
    table.dropUnique(["event_id"]);
    table.dropColumn("event_id");
    table.dropColumn("lifecycle_state");
    table.dropColumn("acknowledged_at");
    table.dropColumn("acknowledged_by");
    table.dropColumn("assigned_at");
    table.dropColumn("assigned_to");
    table.dropColumn("closed_at");
    table.dropColumn("closed_by");
    table.dropColumn("closure_note");
    table.dropColumn("updated_at");
  });
}
