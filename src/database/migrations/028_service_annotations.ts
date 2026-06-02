import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("service_annotations", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("service_name").notNullable();
    table.string("entity_type").notNullable();
    table.string("entity_id").nullable();
    table.text("content").notNullable();
    table.string("author").notNullable();
    table.timestamp("start_time").nullable();
    table.timestamp("end_time").nullable();
    table.boolean("active").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["service_name", "entity_type"]);
    table.index(["entity_type", "entity_id"]);
    table.index(["active"]);
  });

  await knex.schema.createTable("service_annotation_audit", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("annotation_id")
      .notNullable()
      .references("id")
      .inTable("service_annotations")
      .onDelete("CASCADE");
    table.string("action").notNullable();
    table.string("actor").notNullable();
    table.jsonb("changes").notNullable().defaultTo("{}");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["annotation_id"]);
    table.index(["created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("service_annotation_audit");
  await knex.schema.dropTableIfExists("service_annotations");
}
