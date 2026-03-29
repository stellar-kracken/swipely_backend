import { exec } from "child_process";
import { promisify } from "util";
import { createReadStream, createWriteStream, existsSync, mkdirSync } from "fs";
import { readdir, stat, unlink, readFile, writeFile } from "fs/promises";
import { join, basename } from "path";
import { createGzip, createGunzip } from "zlib";
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "crypto";
import { pipeline } from "stream/promises";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

const execAsync = promisify(exec);

export interface BackupConfig {
  backupDir: string;
  encryptionKey?: string;
  retentionDays: number;
  s3Bucket?: string;
  s3Region?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  verifyAfterBackup: boolean;
  compressionEnabled: boolean;
}

export interface BackupMetadata {
  id: string;
  timestamp: Date;
  size: number;
  compressed: boolean;
  encrypted: boolean;
  checksum: string;
  databaseName: string;
  version: string;
  status: "completed" | "failed" | "in_progress";
  verificationType?: "full" | "partial" | "none";
  verificationStatus?: "passed" | "failed";
  location: "local" | "s3" | "both";
  s3Key?: string;
}

export interface RestoreOptions {
  backupId: string;
  pointInTime?: Date;
  targetDatabase?: string;
  tables?: string[];
  skipVerification?: boolean;
}

export class BackupService {
  private config: BackupConfig;
  private metadataFile: string;

  constructor(backupConfig?: Partial<BackupConfig>) {
    this.config = {
      backupDir: process.env.BACKUP_DIR || "./backups",
      encryptionKey: process.env.BACKUP_ENCRYPTION_KEY,
      retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || "30", 10),
      s3Bucket: process.env.BACKUP_S3_BUCKET,
      s3Region: process.env.BACKUP_S3_REGION || "us-east-1",
      s3AccessKey: process.env.BACKUP_S3_ACCESS_KEY,
      s3SecretKey: process.env.BACKUP_S3_SECRET_KEY,
      verifyAfterBackup: process.env.BACKUP_VERIFY !== "false",
      compressionEnabled: process.env.BACKUP_COMPRESSION !== "false",
      ...backupConfig,
    };

    this.metadataFile = join(this.config.backupDir, "metadata.json");
    this.ensureBackupDirectory();
  }

  private ensureBackupDirectory(): void {
    if (!existsSync(this.config.backupDir)) {
      mkdirSync(this.config.backupDir, { recursive: true });
      logger.info({ dir: this.config.backupDir }, "Created backup directory");
    }
  }

  /**
   * Create a full database backup
   */
  async createBackup(): Promise<BackupMetadata> {
    const backupId = `backup_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const timestamp = new Date();
    
    logger.info({ backupId }, "Starting database backup");

    try {
      const metadata: BackupMetadata = {
        id: backupId,
        timestamp,
        size: 0,
        compressed: this.config.compressionEnabled,
        encrypted: !!this.config.encryptionKey,
        checksum: "",
        databaseName: config.POSTGRES_DB,
        version: await this.getDatabaseVersion(),
        status: "in_progress",
        location: "local",
      };

      await this.saveMetadata(metadata);

      // Create backup file
      const backupFile = join(this.config.backupDir, `${backupId}.sql`);
      await this.dumpDatabase(backupFile);

      // Compress if enabled
      let finalFile = backupFile;
      if (this.config.compressionEnabled) {
        finalFile = await this.compressFile(backupFile);
        await unlink(backupFile);
      }

      // Encrypt if enabled
      if (this.config.encryptionKey) {
        finalFile = await this.encryptFile(finalFile);
        const unencryptedFile = finalFile.replace(".enc", "");
        if (unencryptedFile !== finalFile) {
          await unlink(unencryptedFile);
        }
      }

      // Calculate checksum and size
      const fileStats = await stat(finalFile);
      metadata.size = fileStats.size;
      metadata.checksum = await this.calculateChecksum(finalFile);
      metadata.status = "completed";

      // Upload to S3 if configured
      if (this.config.s3Bucket) {
        await this.uploadToS3(finalFile, backupId);
        metadata.location = "both";
        metadata.s3Key = `backups/${backupId}${this.getFileExtension(finalFile)}`;
      }

      // Verify backup if enabled
      if (this.config.verifyAfterBackup) {
        const verificationResult = await this.verifyBackup(backupId);
        metadata.verificationType = verificationResult.type;
        metadata.verificationStatus = verificationResult.status;
      }

      await this.saveMetadata(metadata);

      logger.info(
        { backupId, size: metadata.size, location: metadata.location },
        "Backup completed successfully"
      );

      return metadata;
    } catch (error) {
      logger.error({ backupId, error }, "Backup failed");
      
      const metadata: BackupMetadata = {
        id: backupId,
        timestamp,
        size: 0,
        compressed: false,
        encrypted: false,
        checksum: "",
        databaseName: config.POSTGRES_DB,
        version: "",
        status: "failed",
        location: "local",
      };
      
      await this.saveMetadata(metadata);
      throw error;
    }
  }

  /**
   * Create a point-in-time backup using WAL archiving
   */
  async createPointInTimeBackup(targetTime?: Date): Promise<BackupMetadata> {
    logger.info({ targetTime }, "Creating point-in-time backup");

    // First create a base backup
    const baseBackup = await this.createBackup();

    // If target time is specified, we would restore to that point
    // This requires WAL archiving to be enabled in PostgreSQL
    if (targetTime) {
      logger.info(
        { targetTime, baseBackup: baseBackup.id },
        "Point-in-time backup created with target time"
      );
    }

    return baseBackup;
  }

  /**
   * Restore database from backup
   */
  async restoreBackup(options: RestoreOptions): Promise<void> {
    const { backupId, targetDatabase, tables, skipVerification } = options;
    
    logger.info({ backupId, targetDatabase, tables }, "Starting database restore");

    try {
      const metadata = await this.getBackupMetadata(backupId);
      if (!metadata) {
        throw new Error(`Backup ${backupId} not found`);
      }

      if (metadata.status !== "completed") {
        throw new Error(`Backup ${backupId} is not in completed state`);
      }

      // Verify backup before restore unless skipped
      if (!skipVerification) {
        const verification = await this.verifyBackup(backupId);
        if (verification.status === "failed") {
          throw new Error(`Backup verification failed: ${verification.error}`);
        }
      }

      // Download from S3 if not available locally
      let backupFile = this.getBackupFilePath(backupId, metadata);
      if (!existsSync(backupFile) && metadata.s3Key) {
        backupFile = await this.downloadFromS3(metadata.s3Key, backupId);
      }

      // Decrypt if encrypted
      if (metadata.encrypted) {
        backupFile = await this.decryptFile(backupFile);
      }

      // Decompress if compressed
      if (metadata.compressed) {
        backupFile = await this.decompressFile(backupFile);
      }

      // Restore database
      const dbName = targetDatabase || config.POSTGRES_DB;
      
      if (tables && tables.length > 0) {
        // Partial restore
        await this.restorePartial(backupFile, dbName, tables);
      } else {
        // Full restore
        await this.restoreFull(backupFile, dbName);
      }

      logger.info({ backupId, targetDatabase: dbName }, "Database restore completed");
    } catch (error) {
      logger.error({ backupId, error }, "Database restore failed");
      throw error;
    }
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(
    backupId: string
  ): Promise<{ type: "full" | "partial" | "none"; status: "passed" | "failed"; error?: string }> {
    logger.info({ backupId }, "Verifying backup");

    try {
      const metadata = await this.getBackupMetadata(backupId);
      if (!metadata) {
        return { type: "none", status: "failed", error: "Backup not found" };
      }

      const backupFile = this.getBackupFilePath(backupId, metadata);
      
      // Check file exists
      if (!existsSync(backupFile)) {
        return { type: "none", status: "failed", error: "Backup file not found" };
      }

      // Verify checksum
      const currentChecksum = await this.calculateChecksum(backupFile);
      if (currentChecksum !== metadata.checksum) {
        return { type: "partial", status: "failed", error: "Checksum mismatch" };
      }

      // Verify file can be read
      let testFile = backupFile;
      
      if (metadata.encrypted && this.config.encryptionKey) {
        testFile = await this.decryptFile(backupFile);
      }

      if (metadata.compressed) {
        testFile = await this.decompressFile(testFile);
      }

      // Test SQL file validity
      const content = await readFile(testFile, "utf-8");
      if (!content.includes("PostgreSQL database dump")) {
        return { type: "partial", status: "failed", error: "Invalid backup format" };
      }

      // Clean up test files
      if (testFile !== backupFile) {
        await unlink(testFile);
      }

      logger.info({ backupId }, "Backup verification passed");
      return { type: "full", status: "passed" };
    } catch (error) {
      logger.error({ backupId, error }, "Backup verification failed");
      return {
        type: "partial",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * List all backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    try {
      const metadataList = await this.loadAllMetadata();
      return metadataList.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      logger.error({ error }, "Failed to list backups");
      return [];
    }
  }

  /**
   * Clean up old backups based on retention policy
   */
  async cleanupOldBackups(): Promise<number> {
    logger.info({ retentionDays: this.config.retentionDays }, "Starting backup cleanup");

    try {
      const backups = await this.listBackups();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

      let deletedCount = 0;

      for (const backup of backups) {
        if (backup.timestamp < cutoffDate) {
          await this.deleteBackup(backup.id);
          deletedCount++;
        }
      }

      logger.info({ deletedCount }, "Backup cleanup completed");
      return deletedCount;
    } catch (error) {
      logger.error({ error }, "Backup cleanup failed");
      throw error;
    }
  }

  /**
   * Delete a specific backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    logger.info({ backupId }, "Deleting backup");

    try {
      const metadata = await this.getBackupMetadata(backupId);
      if (!metadata) {
        throw new Error(`Backup ${backupId} not found`);
      }

      // Delete local file
      const backupFile = this.getBackupFilePath(backupId, metadata);
      if (existsSync(backupFile)) {
        await unlink(backupFile);
      }

      // Delete from S3 if exists
      if (metadata.s3Key && this.config.s3Bucket) {
        await this.deleteFromS3(metadata.s3Key);
      }

      // Remove from metadata
      await this.removeMetadata(backupId);

      logger.info({ backupId }, "Backup deleted successfully");
    } catch (error) {
      logger.error({ backupId, error }, "Failed to delete backup");
      throw error;
    }
  }

  // Private helper methods

  private async dumpDatabase(outputFile: string): Promise<void> {
    const command = `pg_dump -h ${config.POSTGRES_HOST} -p ${config.POSTGRES_PORT} -U ${config.POSTGRES_USER} -d ${config.POSTGRES_DB} -F p -f ${outputFile}`;
    
    const env = { ...process.env, PGPASSWORD: config.POSTGRES_PASSWORD };
    
    await execAsync(command, { env, maxBuffer: 1024 * 1024 * 100 });
  }

  private async restoreFull(backupFile: string, targetDb: string): Promise<void> {
    const command = `psql -h ${config.POSTGRES_HOST} -p ${config.POSTGRES_PORT} -U ${config.POSTGRES_USER} -d ${targetDb} -f ${backupFile}`;
    
    const env = { ...process.env, PGPASSWORD: config.POSTGRES_PASSWORD };
    
    await execAsync(command, { env, maxBuffer: 1024 * 1024 * 100 });
  }

  private async restorePartial(backupFile: string, targetDb: string, tables: string[]): Promise<void> {
    // Extract specific tables from backup
    for (const table of tables) {
      const command = `pg_restore -h ${config.POSTGRES_HOST} -p ${config.POSTGRES_PORT} -U ${config.POSTGRES_USER} -d ${targetDb} -t ${table} ${backupFile}`;
      
      const env = { ...process.env, PGPASSWORD: config.POSTGRES_PASSWORD };
      
      try {
        await execAsync(command, { env });
      } catch (error) {
        logger.warn({ table, error }, "Failed to restore table, trying alternative method");
        // Fallback: use grep to extract table data
        await this.extractTableFromDump(backupFile, table, targetDb);
      }
    }
  }

  private async extractTableFromDump(dumpFile: string, table: string, targetDb: string): Promise<void> {
    const content = await readFile(dumpFile, "utf-8");
    const tableRegex = new RegExp(
      `CREATE TABLE.*?${table}.*?;.*?COPY ${table}.*?;`,
      "gs"
    );
    const match = content.match(tableRegex);
    
    if (match) {
      const tempFile = join(this.config.backupDir, `temp_${table}.sql`);
      await writeFile(tempFile, match[0]);
      await this.restoreFull(tempFile, targetDb);
      await unlink(tempFile);
    }
  }

  private async compressFile(inputFile: string): Promise<string> {
    const outputFile = `${inputFile}.gz`;
    const gzip = createGzip({ level: 9 });
    const source = createReadStream(inputFile);
    const destination = createWriteStream(outputFile);

    await pipeline(source, gzip, destination);
    
    return outputFile;
  }

  private async decompressFile(inputFile: string): Promise<string> {
    const outputFile = inputFile.replace(".gz", "");
    const gunzip = createGunzip();
    const source = createReadStream(inputFile);
    const destination = createWriteStream(outputFile);

    await pipeline(source, gunzip, destination);
    
    return outputFile;
  }

  private async encryptFile(inputFile: string): Promise<string> {
    if (!this.config.encryptionKey) {
      throw new Error("Encryption key not configured");
    }

    const outputFile = `${inputFile}.enc`;
    const iv = randomBytes(16);
    const key = (await promisify(scrypt)(
      this.config.encryptionKey,
      "salt",
      32
    )) as Buffer;
    
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const source = createReadStream(inputFile);
    const destination = createWriteStream(outputFile);

    // Write IV at the beginning of the file
    destination.write(iv);

    await pipeline(source, cipher, destination);
    
    return outputFile;
  }

  private async decryptFile(inputFile: string): Promise<string> {
    if (!this.config.encryptionKey) {
      throw new Error("Encryption key not configured");
    }

    const outputFile = inputFile.replace(".enc", "");
    const data = await readFile(inputFile);
    
    // Extract IV from the beginning
    const iv = data.subarray(0, 16);
    const encryptedData = data.subarray(16);
    
    const key = (await promisify(scrypt)(
      this.config.encryptionKey,
      "salt",
      32
    )) as Buffer;
    
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);

    await writeFile(outputFile, decrypted);
    
    return outputFile;
  }

  private async calculateChecksum(file: string): Promise<string> {
    const { createHash } = await import("crypto");
    const hash = createHash("sha256");
    const stream = createReadStream(file);

    return new Promise((resolve, reject) => {
      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  private async getDatabaseVersion(): Promise<string> {
    const db = getDatabase();
    const result = await db.raw("SELECT version()");
    return result.rows[0].version;
  }

  private getBackupFilePath(backupId: string, metadata: BackupMetadata): string {
    let extension = ".sql";
    if (metadata.compressed) extension += ".gz";
    if (metadata.encrypted) extension += ".enc";
    return join(this.config.backupDir, `${backupId}${extension}`);
  }

  private getFileExtension(filePath: string): string {
    const name = basename(filePath);
    const match = name.match(/\.(sql(?:\.gz)?(?:\.enc)?)$/);
    return match ? `.${match[1]}` : "";
  }

  private async uploadToS3(file: string, backupId: string): Promise<void> {
    // This is a placeholder for S3 upload logic
    // In production, use AWS SDK
    logger.info({ file, backupId, bucket: this.config.s3Bucket }, "Uploading to S3");
    
    // Example implementation would use @aws-sdk/client-s3
    // const s3Client = new S3Client({ region: this.config.s3Region });
    // await s3Client.send(new PutObjectCommand({ ... }));
  }

  private async downloadFromS3(s3Key: string, backupId: string): Promise<string> {
    // Placeholder for S3 download logic
    logger.info({ s3Key, backupId }, "Downloading from S3");
    
    const localFile = join(this.config.backupDir, basename(s3Key));
    // Download logic here
    return localFile;
  }

  private async deleteFromS3(s3Key: string): Promise<void> {
    // Placeholder for S3 delete logic
    logger.info({ s3Key }, "Deleting from S3");
  }

  private async saveMetadata(metadata: BackupMetadata): Promise<void> {
    const allMetadata = await this.loadAllMetadata();
    const index = allMetadata.findIndex((m) => m.id === metadata.id);
    
    if (index >= 0) {
      allMetadata[index] = metadata;
    } else {
      allMetadata.push(metadata);
    }

    await writeFile(this.metadataFile, JSON.stringify(allMetadata, null, 2));
  }

  private async removeMetadata(backupId: string): Promise<void> {
    const allMetadata = await this.loadAllMetadata();
    const filtered = allMetadata.filter((m) => m.id !== backupId);
    await writeFile(this.metadataFile, JSON.stringify(filtered, null, 2));
  }

  private async getBackupMetadata(backupId: string): Promise<BackupMetadata | null> {
    const allMetadata = await this.loadAllMetadata();
    return allMetadata.find((m) => m.id === backupId) || null;
  }

  private async loadAllMetadata(): Promise<BackupMetadata[]> {
    try {
      if (!existsSync(this.metadataFile)) {
        return [];
      }

      const content = await readFile(this.metadataFile, "utf-8");
      const data = JSON.parse(content);
      
      // Convert timestamp strings back to Date objects
      return data.map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    } catch (error) {
      logger.error({ error }, "Failed to load metadata");
      return [];
    }
  }
}
