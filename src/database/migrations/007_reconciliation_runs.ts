import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("reconciliation_runs", (table) => {
    table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
    table.uuid("id").notNullable().defaultTo(knex.raw("gen_random_uuid()"));

    table.string("asset_code").notNullable();
    table.string("job_id").nullable();

    table
      .string("status")
      .notNullable()
      .defaultTo("running")
      .checkIn(["running", "success", "mismatch", "failed"]);

    table.decimal("stellar_supply", 30, 7).nullable();
    table.decimal("reported_supply", 30, 7).nullable();
    table.decimal("mismatch_percentage", 20, 8).nullable();

    table.integer("attempt").notNullable().defaultTo(1);
    table.text("error").nullable();

    table.timestamp("finished_at").nullable();
    table.timestamps(true, true);

    table.index(["asset_code", "started_at"]);
    table.index(["status", "started_at"]);
  });

  await knex.raw(
    "SELECT create_hypertable('reconciliation_runs', 'started_at', if_not_exists => TRUE)"
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("reconciliation_runs");
}
