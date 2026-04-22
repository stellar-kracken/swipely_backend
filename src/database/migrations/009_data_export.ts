import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Export requests table
  await knex.schema.createTable("export_requests", (table) => {
    table.string("id").primary();
    table.string("user_id").notNullable();
    table.string("export_type").notNullable();
    table.enum("format", ["csv", "json", "excel"]).notNullable();
    table.jsonb("filters").notNullable().defaultTo("{}");
    table.jsonb("fields").notNullable().defaultTo("[]");
    table
      .enum("status", ["pending", "processing", "completed", "failed"])
      .notNullable()
      .defaultTo("pending");
    table.text("download_url");
    table.integer("file_size");
    table.integer("row_count");
    table.text("error_message");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("completed_at");
    table.timestamp("expires_at");

    table.index(["user_id", "created_at"]);
    table.index(["status"]);
    table.index(["expires_at"]);
  });

  // Export templates table
  await knex.schema.createTable("export_templates", (table) => {
    table.string("id").primary();
    table.string("name").notNullable();
    table.text("description");
    table.string("export_type").notNullable();
    table.enum("default_format", ["csv", "json", "excel"]).notNullable();
    table.jsonb("default_fields").notNullable().defaultTo("[]");
    table.jsonb("default_filters").notNullable().defaultTo("{}");
    table.string("created_by").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["export_type"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("export_templates");
  await knex.schema.dropTableIfExists("export_requests");
}
