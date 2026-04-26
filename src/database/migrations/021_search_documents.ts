import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("search_documents", (table) => {
    table.string("document_key").primary();
    table.string("entity_type").notNullable();
    table.string("entity_id").notNullable();
    table.string("title").notNullable();
    table.text("subtitle").nullable();
    table.text("body").nullable();
    table.text("search_tokens").nullable();
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.integer("rank_weight").notNullable().defaultTo(100);
    table.string("visibility").notNullable().defaultTo("public");
    table.timestamp("source_updated_at").notNullable();
    table.timestamp("indexed_at").notNullable().defaultTo(knex.fn.now());

    table.unique(["entity_type", "entity_id"]);
    table.index(["entity_type", "source_updated_at"]);
    table.index(["visibility", "entity_type"]);
    table.index(["rank_weight"]);
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_search_documents_tsv
    ON search_documents
    USING gin(
      to_tsvector(
        'simple',
        COALESCE(title, '') || ' ' ||
        COALESCE(subtitle, '') || ' ' ||
        COALESCE(body, '') || ' ' ||
        COALESCE(search_tokens, '')
      )
    )
  `);

  await knex("search_index_metadata")
    .insert([
      {
        entity_type: "asset",
        status: "pending",
        index_config: { fields: ["title", "subtitle", "search_tokens"] },
      },
      {
        entity_type: "bridge",
        status: "pending",
        index_config: { fields: ["title", "subtitle", "search_tokens"] },
      },
      {
        entity_type: "incident",
        status: "pending",
        index_config: { fields: ["title", "body", "search_tokens"] },
      },
      {
        entity_type: "alert",
        status: "pending",
        index_config: { fields: ["title", "body", "search_tokens"] },
      },
    ])
    .onConflict("entity_type")
    .merge({
      status: knex.raw("excluded.status"),
      index_config: knex.raw("excluded.index_config"),
      last_indexed: knex.fn.now(),
    } as Record<string, unknown>);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP INDEX IF EXISTS idx_search_documents_tsv");
  await knex.schema.dropTableIfExists("search_documents");
}
