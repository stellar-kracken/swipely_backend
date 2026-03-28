import type { Knex } from "knex";

const PREFERENCE_DEFAULT_ROWS = [
  {
    category: "notifications",
    pref_key: "emailEnabled",
    value: true,
    schema_version: 2,
  },
  {
    category: "notifications",
    pref_key: "pushEnabled",
    value: true,
    schema_version: 2,
  },
  {
    category: "notifications",
    pref_key: "digestFrequency",
    value: "daily",
    schema_version: 2,
  },
  {
    category: "display",
    pref_key: "theme",
    value: "system",
    schema_version: 2,
  },
  {
    category: "display",
    pref_key: "compactMode",
    value: false,
    schema_version: 2,
  },
  {
    category: "display",
    pref_key: "timezone",
    value: "UTC",
    schema_version: 2,
  },
  {
    category: "display",
    pref_key: "currency",
    value: "USD",
    schema_version: 2,
  },
  {
    category: "alerts",
    pref_key: "defaultSeverity",
    value: "medium",
    schema_version: 2,
  },
  {
    category: "alerts",
    pref_key: "channels",
    value: ["in_app"],
    schema_version: 2,
  },
  {
    category: "alerts",
    pref_key: "mutedAssets",
    value: [],
    schema_version: 2,
  },
] as const;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("preference_defaults", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("category").notNullable();
    table.string("pref_key").notNullable();
    table.jsonb("value").notNullable();
    table.integer("schema_version").notNullable().defaultTo(2);
    table.timestamps(true, true);

    table.unique(["category", "pref_key", "schema_version"]);
    table.index(["schema_version", "category"]);
  });

  await knex.schema.createTable("user_preference_state", (table) => {
    table.string("user_id").primary();
    table.integer("version").notNullable().defaultTo(1);
    table.integer("schema_version").notNullable().defaultTo(2);
    table.timestamps(true, true);
  });

  await knex.schema.createTable("user_preferences", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("user_id").notNullable();
    table.string("category").notNullable();
    table.string("pref_key").notNullable();
    table.jsonb("value").notNullable();
    table.timestamps(true, true);

    table.unique(["user_id", "category", "pref_key"]);
    table.index(["user_id", "category"]);
    table
      .foreign("user_id")
      .references("user_id")
      .inTable("user_preference_state")
      .onDelete("CASCADE");
  });

  await knex.schema.createTable("preference_migration_history", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("user_id").nullable();
    table.integer("from_schema_version").notNullable();
    table.integer("to_schema_version").notNullable();
    table.string("migration_name").notNullable();
    table.jsonb("metadata").nullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["user_id", "created_at"]);
  });

  await knex("preference_defaults").insert(
    PREFERENCE_DEFAULT_ROWS.map((row) => ({
      ...row,
      value: knex.raw("?::jsonb", [JSON.stringify(row.value)]),
    }))
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("preference_migration_history");
  await knex.schema.dropTableIfExists("user_preferences");
  await knex.schema.dropTableIfExists("user_preference_state");
  await knex.schema.dropTableIfExists("preference_defaults");
}
