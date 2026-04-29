#!/usr/bin/env tsx

/**
 * Bulk Configuration Import Script
 * Issue: #377
 * 
 * Usage:
 *   tsx scripts/import-configs.ts <environment> <config-file.json> <imported-by> [reason]
 * 
 * Example:
 *   tsx scripts/import-configs.ts prod-us-east ./config-prod.json admin@example.com "Initial prod import"
 */

import { readFileSync } from "fs";
import { getDatabase } from "../src/database/connection.js";
import { createRedisClient } from "../src/config/redis.js";
import { ConfigService } from "../src/services/config-service/ConfigService.js";
import { logger } from "../src/utils/logger.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error("Usage: tsx scripts/import-configs.ts <environment> <config-file.json> <imported-by> [reason]");
    console.error("");
    console.error("Arguments:");
    console.error("  environment    Target environment (global, dev, staging, prod-us-east, prod-eu-west)");
    console.error("  config-file    Path to JSON file containing configurations");
    console.error("  imported-by    User or service account performing the import");
    console.error("  reason         Optional reason for the import");
    console.error("");
    console.error("Example:");
    console.error("  tsx scripts/import-configs.ts prod-us-east ./config-prod.json admin@example.com \"Initial prod import\"");
    process.exit(1);
  }

  const [environment, configFile, importedBy, reason] = args;
  const importReason = reason || "Bulk config import via script";

  // Validate environment
  const validEnvironments = ["global", "dev", "staging", "prod-us-east", "prod-eu-west"];
  if (!validEnvironments.includes(environment)) {
    console.error(`Error: Invalid environment "${environment}"`);
    console.error(`Valid environments: ${validEnvironments.join(", ")}`);
    process.exit(1);
  }

  try {
    // Read config file
    console.log(`Reading config file: ${configFile}`);
    const configData = readFileSync(configFile, "utf-8");
    const configs = JSON.parse(configData);

    if (typeof configs !== "object" || configs === null) {
      console.error("Error: Config file must contain a JSON object");
      process.exit(1);
    }

    const configCount = Object.keys(configs).length;
    console.log(`Found ${configCount} configurations to import`);

    // Initialize services
    console.log("Initializing database and Redis connections...");
    const db = getDatabase();
    const redis = createRedisClient();
    const configService = new ConfigService(db, redis);

    // Import configurations
    console.log(`Importing configurations to environment: ${environment}`);
    console.log(`Imported by: ${importedBy}`);
    console.log(`Reason: ${importReason}`);
    console.log("");

    const startTime = Date.now();

    await configService.importConfig(configs, environment, importedBy, importReason);

    const duration = Date.now() - startTime;

    console.log("");
    console.log("✅ Import completed successfully!");
    console.log(`   Imported: ${configCount} configurations`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Environment: ${environment}`);

    // Close connections
    await db.destroy();
    redis.disconnect();

    process.exit(0);
  } catch (error: any) {
    console.error("");
    console.error("❌ Import failed:");
    console.error(`   ${error.message}`);
    
    if (error.stack) {
      logger.error({ error }, "Config import failed");
    }

    process.exit(1);
  }
}

main();
