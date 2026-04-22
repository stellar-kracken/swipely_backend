# Balance Tracking Service

## Scope

Tracks key addresses for bridged assets across Stellar and supported EVM chains.

## Current tracked address categories

- Issuer accounts
- Bridge reserve addresses
- Custody addresses

## Stored tables

- `tracked_balances`
- `balance_history`

## Capabilities

- Multi-chain balance aggregation
- Balance change detection with percentage deltas
- Historical snapshot storage
- Cross-chain comparison endpoint
- Reconciliation endpoint for issuer vs reserve/custody balances
- Real-time Stellar refresh via Horizon streaming

## API endpoints

- `GET /api/v1/balances`
- `POST /api/v1/balances/sync`
- `POST /api/v1/balances/stream/start`
- `POST /api/v1/balances/stream/stop`
- `GET /api/v1/balances/history/:assetCode`
- `GET /api/v1/balances/compare/:assetCode`
- `GET /api/v1/balances/reconcile/:assetCode`
