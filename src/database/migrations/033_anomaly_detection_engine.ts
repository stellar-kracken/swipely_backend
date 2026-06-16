import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("anomaly_thresholds", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("asset_code").notNullable().defaultTo("*");
    table.string("bridge_name").notNullable().defaultTo("*");
    table.decimal("price_change_pct", 12, 6).notNullable().defaultTo(5);
    table.decimal("liquidity_change_pct", 12, 6).notNullable().defaultTo(25);
    table.decimal("supply_mismatch_pct", 12, 6).notNullable().defaultTo(1);
    table.integer("health_score_drop").notNullable().defaultTo(10);
    table.integer("min_signal_count").notNullable().defaultTo(2);
    table.integer("duplicate_window_seconds").notNullable().defaultTo(900);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamps(true, true);

    table.unique(["asset_code", "bridge_name"]);
    table.index(["asset_code", "is_active"]);
    table.index(["bridge_name", "is_active"]);
  });

  await knex.schema.createTable("anomaly_events", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("asset_code").notNullable();
    table.string("bridge_name").nullable();
    table.string("type").notNullable();
    table.string("severity").notNullable();
    table.jsonb("signals").notNullable();
    table.jsonb("explanation").notNullable();
    table.jsonb("metadata").notNullable().defaultTo("{}");
    table.string("fingerprint").notNullable();
    table.timestamp("detected_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("suppressed_until").nullable();
    table.boolean("is_suppressed").notNullable().defaultTo(false);
    table.uuid("suppressed_by_event_id").nullable();

    table.index(["asset_code", "detected_at"]);
    table.index(["bridge_name", "detected_at"]);
    table.index(["severity", "detected_at"]);
    table.index(["fingerprint", "detected_at"]);
  });

  await knex("anomaly_thresholds").insert({
    asset_code: "*",
    bridge_name: "*",
    price_change_pct: 5,
    liquidity_change_pct: 25,
    supply_mismatch_pct: 1,
    health_score_drop: 10,
    min_signal_count: 2,
    duplicate_window_seconds: 900,
    is_active: true,
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("anomaly_events");
  await knex.schema.dropTableIfExists("anomaly_thresholds");
}
