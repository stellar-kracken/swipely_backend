import { getDatabase } from "./connection.js";
import { logger } from "../utils/logger.js";

async function migrate() {
  const db = getDatabase();

  try {
    logger.info("Running database migrations...");
    await db.migrate.latest();
    logger.info("Migrations completed successfully");
  } catch (error) {
    logger.error({ error }, "Migration failed");
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

migrate();
