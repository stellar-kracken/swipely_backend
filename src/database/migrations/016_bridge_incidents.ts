import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("bridge_incidents", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("bridge_id").notNullable();
    table.string("asset_code").nullable();
    table.string("severity").notNullable().defaultTo("low"); // critical | high | medium | low
    table.string("status").notNullable().defaultTo("open"); // open | investigating | resolved
    table.string("title").notNullable();
    table.text("description").notNullable();
    table.string("source_url").nullable();
    table.jsonb("follow_up_actions").notNullable().defaultTo("[]");
    table.timestamp("occurred_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("resolved_at").nullable();
    table.timestamps(true, true);

    table.index(["bridge_id", "occurred_at"]);
    table.index(["asset_code", "occurred_at"]);
    table.index(["severity"]);
    table.index(["status"]);
  });

  await knex.schema.createTable("bridge_incident_reads", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("incident_id")
      .notNullable()
      .references("id")
      .inTable("bridge_incidents")
      .onDelete("CASCADE");
    table.string("user_session").notNullable();
    table.timestamp("read_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["incident_id", "user_session"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("bridge_incident_reads");
  await knex.schema.dropTableIfExists("bridge_incidents");
}
