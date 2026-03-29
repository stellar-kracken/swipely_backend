# Backup and Recovery System

## Overview

The Stellar Bridge Watch backup and recovery system provides automated, secure, and reliable database backups with point-in-time recovery capabilities.

## Features

- ✅ Automated database backups
- ✅ Point-in-time recovery
- ✅ Backup verification
- ✅ Offsite backup storage (S3)
- ✅ Backup encryption (AES-256-CBC)
- ✅ Recovery testing procedures
- ✅ Backup scheduling with BullMQ
- ✅ Retention policies
- ✅ Monitoring and alerting
- ✅ Recovery documentation
- ✅ Partial restoration support
- ✅ Configuration backups

## Quick Start

### Installation

The backup system is included in the main application. No additional installation required.

### Configuration

Add the following environment variables to your `.env` file:

```bash
# Required
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=30

# Optional but recommended
BACKUP_ENCRYPTION_KEY=your-secure-encryption-key
BACKUP_VERIFY=true
BACKUP_COMPRESSION=true

# Optional - S3 offsite backup
BACKUP_S3_BUCKET=bridge-watch-backups
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY=your-aws-access-key
BACKUP_S3_SECRET_KEY=your-aws-secret-key
```

### Basic Usage

```bash
# Create a backup
npm run backup:create

# List all backups
npm run backup:list

# Verify a backup
npm run backup verify <backup-id>

# Restore from backup
npm run backup restore <backup-id>

# Cleanup old backups
npm run backup:cleanup
```

## CLI Commands

### Create Backup

```bash
npm run backup create
```

Creates a full database backup with compression and encryption (if configured).

### List Backups

```bash
npm run backup list
```

Displays all available backups with their metadata.

### Verify Backup

```bash
npm run backup verify <backup-id>
```

Verifies the integrity of a specific backup.

### Restore Backup

```bash
# Full restore
npm run backup restore <backup-id>

# Restore to different database
npm run backup restore <backup-id> --target-db=recovery_db

# Partial restore (specific tables)
npm run backup restore-partial <backup-id> --tables=assets,bridges

# Skip verification (faster but not recommended)
npm run backup restore <backup-id> --skip-verification
```

### Backup Information

```bash
npm run backup info <backup-id>
```

Shows detailed information about a specific backup.

### Delete Backup

```bash
npm run backup delete <backup-id>
```

Deletes a specific backup from local and S3 storage.

### Cleanup Old Backups

```bash
npm run backup cleanup
```

Removes backups older than the retention period.

## Automated Backups

Backups are automatically scheduled using BullMQ:

| Job                | Schedule             | Description                    |
| ------------------ | -------------------- | ------------------------------ |
| Full Backup        | Daily at 2:00 AM UTC | Complete database backup       |
| Incremental Backup | Every 6 hours        | Point-in-time recovery support |
| Cleanup            | Daily at 3:00 AM UTC | Remove old backups             |
| Health Check       | Every hour           | Monitor backup system health   |
| Metrics Collection | Every 15 minutes     | Collect backup metrics         |

## Backup Storage

### Local Storage

Backups are stored locally in the directory specified by `BACKUP_DIR` (default: `./backups`).

**File naming convention:**

```
backup_<timestamp>_<random>.sql[.gz][.enc]
```

Example: `backup_1710504000000_a1b2c3d4.sql.gz.enc`

### S3 Storage

If S3 is configured, backups are automatically uploaded to the specified bucket.

**S3 key format:**

```
backups/backup_<timestamp>_<random>.sql[.gz][.enc]
```

## Security

### Encryption

Backups are encrypted using AES-256-CBC:

- **Algorithm**: AES-256-CBC
- **Key Derivation**: scrypt
- **IV**: Random 16-byte per backup
- **Key Storage**: Environment variable `BACKUP_ENCRYPTION_KEY`

**Generate a secure encryption key:**

```bash
openssl rand -base64 32
```

### Best Practices

1. **Store encryption key securely** - Use a secret management system (AWS Secrets Manager, HashiCorp Vault, etc.)
2. **Rotate encryption keys** - Implement key rotation policy
3. **Restrict access** - Limit who can access backup files and encryption keys
4. **Use IAM roles** - For S3 access, use IAM roles instead of access keys when possible
5. **Enable S3 versioning** - Protect against accidental deletion
6. **Monitor access** - Enable CloudTrail logging for S3 bucket access

## Monitoring

### Metrics

The backup system collects the following metrics:

- Total backup count
- Successful/failed backup ratio
- Backup sizes and growth trends
- Verification success rate
- Backup age
- Storage utilization (local and S3)
- Encrypted/compressed backup counts

### Alerts

Alerts are generated for:

- **Critical**: No backups in 24 hours, backup verification failures
- **Warning**: Low backup count, failed backups, no offsite backups
- **Info**: Large backup sizes, unencrypted backups

### Health Checks

Run a manual health check:

```bash
npm run backup -- health-check
```

Or check the logs for automated health check results.

## Recovery Procedures

### Full Database Recovery

See [Recovery Runbook](./recovery-runbook.md) for detailed procedures.

**Quick recovery:**

```bash
# 1. List backups
npm run backup list

# 2. Verify backup
npm run backup verify <backup-id>

# 3. Stop application
pm2 stop all

# 4. Restore database
npm run backup restore <backup-id>

# 5. Verify restoration
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT COUNT(*) FROM assets;"

# 6. Restart application
pm2 start all
```

### Partial Recovery

Restore specific tables without affecting others:

```bash
npm run backup restore-partial <backup-id> --tables=prices,liquidity_snapshots
```

### Point-in-Time Recovery

Restore to a specific point in time:

```bash
npm run backup restore <backup-id> --point-in-time=2024-03-15T10:30:00Z
```

**Note**: Requires WAL archiving to be enabled in PostgreSQL.

## Testing

### Run Tests

```bash
npm test -- backup.service.test.ts
```

### Manual Testing

1. **Create test backup:**

   ```bash
   npm run backup create
   ```

2. **Verify backup:**

   ```bash
   npm run backup list
   npm run backup verify <backup-id>
   ```

3. **Test restore to separate database:**

   ```bash
   createdb test_restore
   npm run backup restore <backup-id> --target-db=test_restore
   ```

4. **Verify restored data:**

   ```bash
   psql -d test_restore -c "SELECT COUNT(*) FROM assets;"
   ```

5. **Cleanup:**
   ```bash
   dropdb test_restore
   ```

## Troubleshooting

### Backup Creation Fails

**Problem**: Backup creation fails with permission error

**Solution**:

```bash
# Check backup directory permissions
ls -la ./backups

# Create directory with correct permissions
mkdir -p ./backups
chmod 755 ./backups
```

### Restore Fails

**Problem**: Restore fails with "database is being accessed by other users"

**Solution**:

```bash
# Terminate all connections
psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'bridge_watch';"

# Retry restore
npm run backup restore <backup-id>
```

### S3 Upload Fails

**Problem**: S3 upload fails with authentication error

**Solution**:

```bash
# Verify AWS credentials
aws s3 ls s3://$BACKUP_S3_BUCKET

# Check IAM permissions
# Ensure the IAM user/role has s3:PutObject permission
```

### Verification Fails

**Problem**: Backup verification fails with checksum mismatch

**Solution**:

```bash
# Try previous backup
npm run backup list
npm run backup verify <previous-backup-id>

# If all backups fail, create new backup
npm run backup create
```

## Performance

### Backup Duration

Typical backup times (approximate):

| Database Size | Backup Time   | Compressed Size |
| ------------- | ------------- | --------------- |
| 100 MB        | 5-10 seconds  | ~20 MB          |
| 1 GB          | 30-60 seconds | ~200 MB         |
| 10 GB         | 5-10 minutes  | ~2 GB           |
| 100 GB        | 30-60 minutes | ~20 GB          |

### Optimization Tips

1. **Use compression** - Reduces storage by 80-90%
2. **Schedule during low traffic** - Run backups at 2 AM UTC
3. **Use incremental backups** - Faster than full backups
4. **Parallel compression** - Use `pigz` instead of `gzip` for faster compression
5. **Optimize PostgreSQL** - Tune `checkpoint_completion_target` and `wal_buffers`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Backup System                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐      ┌──────────────┐                │
│  │ Backup       │      │ Backup       │                │
│  │ Service      │─────▶│ Worker       │                │
│  └──────────────┘      └──────────────┘                │
│         │                      │                         │
│         │                      ▼                         │
│         │              ┌──────────────┐                │
│         │              │ BullMQ       │                │
│         │              │ Queue        │                │
│         │              └──────────────┘                │
│         │                                               │
│         ▼                                               │
│  ┌──────────────┐      ┌──────────────┐                │
│  │ PostgreSQL   │      │ Monitoring   │                │
│  │ Database     │      │ Service      │                │
│  └──────────────┘      └──────────────┘                │
│         │                      │                         │
│         ▼                      ▼                         │
│  ┌──────────────┐      ┌──────────────┐                │
│  │ Local        │      │ Metrics &    │                │
│  │ Storage      │      │ Alerts       │                │
│  └──────────────┘      └──────────────┘                │
│         │                                               │
│         ▼                                               │
│  ┌──────────────┐                                      │
│  │ S3 Storage   │                                      │
│  │ (Offsite)    │                                      │
│  └──────────────┘                                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## API Reference

### BackupService

```typescript
class BackupService {
  // Create a full backup
  async createBackup(): Promise<BackupMetadata>;

  // Create point-in-time backup
  async createPointInTimeBackup(targetTime?: Date): Promise<BackupMetadata>;

  // Restore from backup
  async restoreBackup(options: RestoreOptions): Promise<void>;

  // Verify backup integrity
  async verifyBackup(backupId: string): Promise<VerificationResult>;

  // List all backups
  async listBackups(): Promise<BackupMetadata[]>;

  // Cleanup old backups
  async cleanupOldBackups(): Promise<number>;

  // Delete specific backup
  async deleteBackup(backupId: string): Promise<void>;
}
```

### BackupMonitoringService

```typescript
class BackupMonitoringService {
  // Collect backup metrics
  async collectMetrics(): Promise<BackupMetrics>;

  // Check backup health
  async checkBackupHealth(): Promise<BackupAlert[]>;

  // Generate status report
  async generateStatusReport(): Promise<string>;

  // Run health check
  async runHealthCheck(): Promise<void>;
}
```

## Documentation

- [Backup Strategy](./backup-strategy.md) - Comprehensive backup strategy documentation
- [Recovery Runbook](./recovery-runbook.md) - Step-by-step recovery procedures
- [API Documentation](./api-docs.md) - API reference

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [Recovery Runbook](./recovery-runbook.md)
3. Check application logs: `pm2 logs`
4. Contact DevOps team

## Contributing

When contributing to the backup system:

1. Add tests for new features
2. Update documentation
3. Test recovery procedures
4. Follow security best practices
5. Update the runbook if procedures change

## License

See [LICENSE](../../LICENSE) file for details.
