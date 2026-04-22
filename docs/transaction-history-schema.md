# Transaction History Schema

This document describes the transaction history tables used by the Horizon transaction fetcher service.

## Table: `asset_transactions`

Stores parsed operation-level records fetched from Horizon.

- `id` (uuid, PK)
- `bridge_name` (text, nullable, FK -> `bridges.name`)
- `asset_code` (text, required)
- `asset_issuer` (text, required)
- `transaction_hash` (text, required)
- `operation_id` (text, unique, required)
- `operation_type` (text, required)
- `status` (text: `pending|completed|failed`, required)
- `ledger` (bigint, nullable)
- `paging_token` (text, required)
- `source_account` (text, nullable)
- `from_address` (text, nullable)
- `to_address` (text, nullable)
- `amount` (decimal(30,8), required)
- `fee_charged` (decimal(30,8), required)
- `occurred_at` (timestamptz, required)
- `raw_transaction` (jsonb, nullable)
- `raw_operation` (jsonb, nullable)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### Indexes

- `idx_asset_transactions_asset_time` on (`asset_code`, `occurred_at`)
- `idx_asset_transactions_asset_op` on (`asset_code`, `operation_type`)
- `idx_asset_transactions_bridge_time` on (`bridge_name`, `occurred_at`)
- `idx_asset_transactions_status_time` on (`status`, `occurred_at`)
- `idx_asset_transactions_hash` on (`transaction_hash`)
- `idx_asset_transactions_paging_token` on (`paging_token`)

## Table: `asset_transaction_sync_state`

Tracks sync cursor and fetch health for recovery and incremental polling.

- `id` (uuid, PK)
- `asset_code` (text, required)
- `asset_issuer` (text, required)
- `last_paging_token` (text, nullable)
- `last_ledger` (bigint, nullable)
- `error_count` (int, required)
- `last_error` (text, nullable)
- `last_synced_at` (timestamptz, nullable)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### Constraints and indexes

- Unique (`asset_code`, `asset_issuer`)
- `idx_asset_transaction_sync_state_asset` on (`asset_code`)

## API endpoints

- `GET /api/v1/transactions`
- `GET /api/v1/transactions/export`
- `POST /api/v1/transactions/fetch`
- `POST /api/v1/transactions/backfill`
- `POST /api/v1/transactions/detect-new`
- `GET /api/v1/transactions/sync-state/:assetCode/:assetIssuer`

## Notes

- Records are stored at operation level to support operation-type filtering.
- Upserts use `operation_id` for idempotency.
- Sync state stores the latest paging token for incremental fetch and recovery.
