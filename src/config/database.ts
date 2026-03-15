import type { Knex } from "knex";
import { config } from "./index.js";

export const databaseConfig: Knex.Config = {
  client: "pg",
  connection: {
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    database: config.POSTGRES_DB,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
  },
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    directory: "../database/migrations",
    tableName: "knex_migrations",
  },
};
