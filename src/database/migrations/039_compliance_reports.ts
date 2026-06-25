import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Report templates table
  await knex.schema.createTable("report_templates", (table) => {
    table.string("id").primary();
    table.string("name").notNullable();
    table.enum("type", [
      "bridge_activity",
      "asset_health",
      "compliance_audit",
      "regulatory_filing",
      "incident_summary",
    ]).notNullable();
    table.text("description");
    table.jsonb("sections").notNullable().defaultTo("[]");
    table.jsonb("includes").notNullable().defaultTo("{}");
    table.jsonb("filters").notNullable().defaultTo("[]");
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["type", "is_active"]);
  });

  // Compliance reports table
  await knex.schema.createTable("compliance_reports", (table) => {
    table.string("id").primary();
    table
      .string("template_id")
      .notNullable()
      .references("id")
      .inTable("report_templates")
      .onDelete("CASCADE");
    table.string("title").notNullable();
    table.enum("type", [
      "bridge_activity",
      "asset_health",
      "compliance_audit",
      "regulatory_filing",
      "incident_summary",
    ]).notNullable();
    table.enum("format", ["pdf", "csv", "json", "html"]).notNullable();
    table.string("generated_by").notNullable();
    table.timestamp("generated_at").notNullable();
    table.timestamp("period_start").notNullable();
    table.timestamp("period_end").notNullable();
    table.text("content").notNullable(); // Base64 encoded for binary formats
    table.string("content_hash", 64).notNullable(); // SHA-256 hash
    table.jsonb("signature_data"); // Digital signature information
    table.jsonb("filters").notNullable().defaultTo("[]");
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.boolean("is_archived").notNullable().defaultTo(false);
    table.timestamp("archived_at");
    table.string("archive_location"); // S3 or local path
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["template_id", "generated_at"]);
    table.index(["generated_by", "generated_at"]);
    table.index(["is_archived"]);
    table.index(["content_hash"]); // For integrity verification
  });

  // Report archives table
  await knex.schema.createTable("report_archives", (table) => {
    table.string("id").primary();
    table
      .string("report_id")
      .notNullable()
      .references("id")
      .inTable("compliance_reports")
      .onDelete("CASCADE");
    table.enum("archive_format", ["tar.gz", "zip"]).notNullable();
    table.text("location").notNullable(); // Path to archived file
    table.bigint("size").notNullable(); // Size in bytes
    table.string("checksum", 64).notNullable(); // SHA-256 hash
    table.integer("retention_days").notNullable().defaultTo(2555); // 7 years
    table.timestamp("expires_at").notNullable();
    table.timestamp("archived_at").notNullable();
    table.jsonb("access_log").notNullable().defaultTo("[]");

    table.index(["report_id"]);
    table.index(["expires_at"]);
    table.index(["archived_at"]);
  });

  // Report access audit log table
  await knex.schema.createTable("report_audit_log", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .string("report_id")
      .references("id")
      .inTable("compliance_reports")
      .onDelete("CASCADE");
    table.string("accessed_by").notNullable();
    table.enum("action", ["view", "download", "verify_signature", "delete"]).notNullable();
    table.string("ip_address");
    table.text("description");
    table.timestamp("accessed_at").notNullable().defaultTo(knex.fn.now());

    table.index(["report_id", "accessed_at"]);
    table.index(["accessed_by", "accessed_at"]);
  });

  // Indexes for query optimization
  await knex.schema.table("compliance_reports", (table) => {
    table.index(["generated_at"]);
    table.index(["type"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("report_audit_log");
  await knex.schema.dropTableIfExists("report_archives");
  await knex.schema.dropTableIfExists("compliance_reports");
  await knex.schema.dropTableIfExists("report_templates");
}
