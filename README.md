# Swipely — Backend

API and monitoring services for **Swipely**, a cross-chain bridge and DEX
liquidity monitoring platform for the Stellar network. This service ingests
on-chain and off-chain data, computes bridge-health and liquidity metrics,
exposes a REST + WebSocket API, and dispatches alerts.

## Tech stack

- **Node.js** + **TypeScript**
- **Fastify 5** (REST, WebSockets, Swagger/OpenAPI)
- **PostgreSQL** via **Knex** (migrations + seeds)
- **Redis** + **BullMQ** for queues and background jobs
- **@stellar/stellar-sdk** and **ethers** for chain access
- **Prometheus** (`prom-client`) metrics, **pino** logging
- Alerting via **Discord**, **Telegram**, and email (**nodemailer**)
- **Zod** for validation, **Vitest** for tests

## Getting started

```bash
npm install
cp .env.example .env        # then fill in the values
npm run migrate             # apply database migrations
npm run dev                 # start the API in watch mode
```

## Useful scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the API with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run migrate` | Apply migrations |
| `npm run seed` | Seed the database |
| `npm run test` | Run the test suite |
| `npm run docs:generate` | Generate the OpenAPI spec |

## Observability

Prometheus scrape config, alert rules, and a Grafana dashboard live alongside the
service (`prometheus.yml`, `prometheus-alerts.yml`, `grafana/`). See
`METRICS_QUICKSTART.md` for a fast local setup.

## Related repositories

- [`swipely_frontend`](https://github.com/stellar-kracken/swipely_frontend) — dashboard UI
- [`swipely_contract`](https://github.com/stellar-kracken/swipely_contract) — Soroban smart contracts

## License

MIT — see [`LICENSE`](./LICENSE).
