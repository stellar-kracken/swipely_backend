#!/usr/bin/env node

import { BackupService, RestoreOptions } from "../services/backup.service.js";
import { logger } from "../utils/logger.js";

const backupService = new BackupService();

interface CliArgs {
  command: string;
  args: string[];
}

function parseArgs(): CliArgs {
  const [, , command, ...args] = process.argv;
  return { command, args };
}

function printUsage(): void {
  console.log(`
Backup CLI - Database Backup and Recovery Tool

Usage:
  npm run backup <command> [options]

Commands:
  create                    Create a new full backup
  list                      List all available backups
  verify <backup-id>        Verify backup integrity
  restore <backup-id>       Restore from backup
  restore-partial <backup-id> --tables=table1,table2
                           Restore specific tables only
  cleanup                   Remove old backups based on retention policy
  delete <backup-id>        Delete a specific backup
  info <backup-id>          Show detailed backup information

Options:
  --target-db=<name>        Target database for restore (default: current)
  --tables=<table1,table2>  Tables to restore (for partial restore)
  --skip-verification       Skip backup verification before restore
  --point-in-time=<date>    Restore to specific point in time (ISO format)

Examples:
  npm run backup create
  npm run backup list
  npm run backup verify backup_1234567890_abcd
  npm run backup restore backup_1234567890_abcd
  npm run backup restore-partial backup_1234567890_abcd --tables=assets,bridges
  npm run backup cleanup
  `);
}

async function createBackup(): Promise<void> {
  console.log("Creating database backup...");
  const metadata = await backupService.createBackup();
  console.log("\nBackup created successfully!");
  console.log(`Backup ID: ${metadata.id}`);
  console.log(`Size: ${(metadata.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Location: ${metadata.location}`);
  console.log(`Checksum: ${metadata.checksum}`);
  if (metadata.verificationStatus) {
    console.log(`Verification: ${metadata.verificationStatus}`);
  }
}

async function listBackups(): Promise<void> {
  console.log("Available backups:\n");
  const backups = await backupService.listBackups();

  if (backups.length === 0) {
    console.log("No backups found.");
    return;
  }

  console.log("ID".padEnd(35), "Date".padEnd(25), "Size".padEnd(12), "Status".padEnd(12), "Location");
  console.log("-".repeat(100));

  for (const backup of backups) {
    const date = backup.timestamp.toISOString();
    const size = `${(backup.size / 1024 / 1024).toFixed(2)} MB`;
    console.log(
      backup.id.padEnd(35),
      date.padEnd(25),
      size.padEnd(12),
      backup.status.padEnd(12),
      backup.location
    );
  }
}

async function verifyBackup(backupId: string): Promise<void> {
  console.log(`Verifying backup: ${backupId}...`);
  const result = await backupService.verifyBackup(backupId);
  
  console.log(`\nVerification Type: ${result.type}`);
  console.log(`Status: ${result.status}`);
  
  if (result.error) {
    console.log(`Error: ${result.error}`);
  }

  if (result.status === "passed") {
    console.log("\n✓ Backup verification passed");
  } else {
    console.log("\n✗ Backup verification failed");
    process.exit(1);
  }
}

async function restoreBackup(backupId: string, options: Partial<RestoreOptions>): Promise<void> {
  console.log(`Restoring from backup: ${backupId}...`);
  
  if (options.tables && options.tables.length > 0) {
    console.log(`Restoring tables: ${options.tables.join(", ")}`);
  }

  const restoreOptions: RestoreOptions = {
    backupId,
    ...options,
  };

  await backupService.restoreBackup(restoreOptions);
  console.log("\n✓ Database restore completed successfully");
}

async function cleanupBackups(): Promise<void> {
  console.log("Cleaning up old backups...");
  const deletedCount = await backupService.cleanupOldBackups();
  console.log(`\n✓ Deleted ${deletedCount} old backup(s)`);
}

async function deleteBackup(backupId: string): Promise<void> {
  console.log(`Deleting backup: ${backupId}...`);
  await backupService.deleteBackup(backupId);
  console.log("\n✓ Backup deleted successfully");
}

async function showBackupInfo(backupId: string): Promise<void> {
  const backups = await backupService.listBackups();
  const backup = backups.find((b) => b.id === backupId);

  if (!backup) {
    console.log(`Backup not found: ${backupId}`);
    process.exit(1);
  }

  console.log("\nBackup Information:");
  console.log("-".repeat(50));
  console.log(`ID:                ${backup.id}`);
  console.log(`Timestamp:         ${backup.timestamp.toISOString()}`);
  console.log(`Database:          ${backup.databaseName}`);
  console.log(`Version:           ${backup.version}`);
  console.log(`Size:              ${(backup.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Status:            ${backup.status}`);
  console.log(`Compressed:        ${backup.compressed ? "Yes" : "No"}`);
  console.log(`Encrypted:         ${backup.encrypted ? "Yes" : "No"}`);
  console.log(`Location:          ${backup.location}`);
  console.log(`Checksum:          ${backup.checksum}`);
  
  if (backup.verificationType) {
    console.log(`Verification Type: ${backup.verificationType}`);
    console.log(`Verification:      ${backup.verificationStatus}`);
  }
  
  if (backup.s3Key) {
    console.log(`S3 Key:            ${backup.s3Key}`);
  }
}

function getOption(args: string[], name: string): string | undefined {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : undefined;
}

async function main(): Promise<void> {
  const { command, args } = parseArgs();

  try {
    switch (command) {
      case "create":
        await createBackup();
        break;

      case "list":
        await listBackups();
        break;

      case "verify":
        if (!args[0]) {
          console.error("Error: backup-id is required");
          printUsage();
          process.exit(1);
        }
        await verifyBackup(args[0]);
        break;

      case "restore":
      case "restore-partial": {
        if (!args[0]) {
          console.error("Error: backup-id is required");
          printUsage();
          process.exit(1);
        }

        const targetDb = getOption(args, "target-db");
        const tablesStr = getOption(args, "tables");
        const skipVerification = args.includes("--skip-verification");
        const pointInTimeStr = getOption(args, "point-in-time");

        const options: Partial<RestoreOptions> = {
          targetDatabase: targetDb,
          tables: tablesStr ? tablesStr.split(",") : undefined,
          skipVerification,
          pointInTime: pointInTimeStr ? new Date(pointInTimeStr) : undefined,
        };

        await restoreBackup(args[0], options);
        break;
      }

      case "cleanup":
        await cleanupBackups();
        break;

      case "delete":
        if (!args[0]) {
          console.error("Error: backup-id is required");
          printUsage();
          process.exit(1);
        }
        await deleteBackup(args[0]);
        break;

      case "info":
        if (!args[0]) {
          console.error("Error: backup-id is required");
          printUsage();
          process.exit(1);
        }
        await showBackupInfo(args[0]);
        break;

      case "help":
      case "--help":
      case "-h":
        printUsage();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    logger.error({ error }, "CLI command failed");
    console.error("\nError:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
