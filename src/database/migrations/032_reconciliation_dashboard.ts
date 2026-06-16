import type { Knex } from "knex";

async function addColumnIfMissing(
  knex: Knex,
  tableName: string,
  columnName: string,
  addColumn: (table: Knex.AlterTableBuilder) => void
) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

export async function up(knex: Knex): Promise<void> {
  await addColumnIfMissing(knex, "reconciliation_runs", "bridge_name", (table) => {
    table.string("bridge_name").nullable();
  });

  await addColumnIfMissing(knex, "reconciliation_runs", "source_chain", (table) => {
    table.string("source_chain").nullable();
  });

  await addColumnIfMissing(knex, "reconciliation_runs", "on_chain_source", (table) => {
    table.jsonb("on_chain_source").nullable();
  });

  await addColumnIfMissing(knex, "reconciliation_runs", "reserve_attestation", (table) => {
    table.jsonb("reserve_attestation").nullable();
  });

  await addColumnIfMissing(knex, "reconciliation_runs", "reported_backing", (table) => {
    table.jsonb("reported_backing").nullable();
  });

  await addColumnIfMissing(knex, "reconciliation_runs", "triage_status", (table) => {
    table.string("triage_status").nullable();
  });

  await addColumnIfMissing(knex, "reconciliation_runs", "triage_owner", (table) => {
    table.string("triage_owner").nullable();
  });

  await addColumnIfMissing(knex, "reconciliation_runs", "triage_note", (table) => {
    table.text("triage_note").nullable();
  });

  await addColumnIfMissing(knex, "reconciliation_runs", "triaged_at", (table) => {
    table.timestamp("triaged_at").nullable();
  });

  await knex.raw(
    "CREATE INDEX IF NOT EXISTS reconciliation_runs_asset_bridge_started_idx ON reconciliation_runs (asset_code, bridge_name, started_at DESC)"
  );
  await knex.raw(
    "CREATE INDEX IF NOT EXISTS reconciliation_runs_triage_status_idx ON reconciliation_runs (triage_status)"
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP INDEX IF EXISTS reconciliation_runs_triage_status_idx");
  await knex.raw("DROP INDEX IF EXISTS reconciliation_runs_asset_bridge_started_idx");

  await knex.schema.alterTable("reconciliation_runs", (table) => {
    table.dropColumn("triaged_at");
    table.dropColumn("triage_note");
    table.dropColumn("triage_owner");
    table.dropColumn("triage_status");
    table.dropColumn("reported_backing");
    table.dropColumn("reserve_attestation");
    table.dropColumn("on_chain_source");
    table.dropColumn("source_chain");
    table.dropColumn("bridge_name");
  });
}
