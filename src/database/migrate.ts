/**
 * Database migration CLI
 *
 * Usage (all commands run from the backend/ directory):
 *
 *   npm run migrate                  Run all pending migrations (default)
 *   npm run migrate:up               Run all pending migrations
 *   npm run migrate:down             Roll back the last migration batch
 *   npm run migrate:rollback         Roll back the last migration batch
 *   npm run migrate:rollback:all     Roll back every applied migration
 *   npm run migrate:status           Show applied / pending migrations
 *   npm run migrate:dry-run          Preview pending migrations without applying
 *   npm run migrate:make -- <name>   Generate a new migration file
 *   npm run migrate:validate         Validate all migration files
 *   npm run migrate:history          Show full migration history
 *   npm run migrate:unlock           Force-release a stuck migration lock
 */

import { Migrator } from "./migrator.js";

const COMMANDS = [
  "up",
  "down",
  "rollback",
  "rollback:all",
  "status",
  "dry-run",
  "make",
  "validate",
  "history",
  "unlock",
] as const;

type Command = (typeof COMMANDS)[number];

function printHelp(): void {
  console.log(`
Bridge Watch — Database Migration CLI

Usage:
  npm run migrate                       Run all pending migrations (default: up)
  npm run migrate:up                    Run all pending migrations
  npm run migrate:down                  Roll back the last batch
  npm run migrate:rollback              Roll back the last batch
  npm run migrate:rollback:all          Roll back ALL migrations
  npm run migrate:status                Show migration status table
  npm run migrate:dry-run               Preview what would run (no DB changes)
  npm run migrate:make -- <name>        Generate a new migration file
  npm run migrate:validate              Validate all migration files
  npm run migrate:history               Show full migration history
  npm run migrate:unlock                Release a stuck migration lock

Locking:
  Knex automatically locks migrations via the knex_migrations_lock table.
  If a run crashes and leaves a lock, use: npm run migrate:unlock

Environment:
  Set NODE_ENV=production to enable production-deployment warnings.
  Supported values: development | test | production
`);
}

async function main(): Promise<void> {
  // process.argv layout: [node, script, command?, ...args]
  const [, , rawCommand, ...args] = process.argv;

  if (rawCommand === "--help" || rawCommand === "-h") {
    printHelp();
    process.exit(0);
  }

  // Default command when script is run with no arguments
  const command = (rawCommand ?? "up") as Command;

  const migrator = new Migrator();

  try {
    switch (command) {
      case "up":
        await migrator.up();
        break;

      case "down":
      case "rollback":
        await migrator.rollback(false);
        break;

      case "rollback:all":
        await migrator.rollback(true);
        break;

      case "status":
        await migrator.status();
        break;

      case "dry-run":
        await migrator.dryRun();
        break;

      case "make": {
        const name = args[0];
        if (!name) {
          console.error("Error: migration name is required.\n  Usage: npm run migrate:make -- <name>");
          process.exit(1);
        }
        await migrator.make(name);
        break;
      }

      case "validate": {
        const valid = await migrator.validate();
        if (!valid) process.exit(1);
        break;
      }

      case "history":
        await migrator.history();
        break;

      case "unlock":
        await migrator.unlock();
        break;

      default:
        console.error(`Unknown command: "${command}"\n`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error("Migration error:", (error as Error).message);
    process.exit(1);
  } finally {
    await migrator.destroy();
  }
}

main();
