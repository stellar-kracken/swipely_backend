import knex, { type Knex } from "knex";
import { databaseConfig } from "../config/database.js";
import { logger } from "../utils/logger.js";

let db: Knex;

export function getDatabase(): Knex {
  if (!db) {
    db = knex(databaseConfig);
    logger.info("Database connection initialized");
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.destroy();
    logger.info("Database connection closed");
  }
}
