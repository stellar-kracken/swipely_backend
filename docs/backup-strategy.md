# Backup and Recovery Strategy

## Overview

This document outlines the comprehensive backup and recovery strategy for the Stellar Bridge Watch system. The strategy ensures data durability, business continuity, and rapid recovery in case of data loss or system failures.

## Backup Architecture

### Components

1. **Backup Service** (`backup.service.ts`)
   - Core backup and restore functionality
   - Encryption and compression
   - Point-in-time recovery support
   - Backup verification

2. **Backup Worker** (`backup.worker.ts`)
   - Scheduled backup execution
   - Automated cleanup
   - Job queue integration

3. **Backup Monitoring** (`backupMonitoring.service.ts`)
   - Health checks
   - Metrics collection
   - Alert generation

4. **Backup CLI** (`backup.cli.ts`)
   - Command-line interface for manual operations
   - Restore procedures
   - Backup management

## Backup Types

### Full Backups

Full database backups capture the complete state of the database at a specific point in time.

- **Frequency**: Daily at 2:00 AM UTC
- **Retention**: 30 days
- **Format**: PostgreSQL dump (plain text SQL)
- **Compression**: gzip (level 9)
- **Encryption**: AES-256-CBC

### Incremental Backups

Incremental backups capture changes since the last backup using PostgreSQL WAL (Write-Ahead Logging).

- **Frequency**: Every 6 hours
- **Retention**: 7 days
- **Use Case**: Point-in-time recovery

### Configuration Backups

Application configuration and environment settings are backed up separately.

- **Frequency**: On change
- **Location**: Version control + encrypted backup
- **Includes**: Environment variables, service configurations

## Storage Strategy

### Local Storage

- **Location**: `/backups` directory (configurable via `BACKUP_DIR`)
- **Purpose**: Fast access for recent backups
- **Retention**: 7 days locally

### Offsite Storage (S3)

- **Provider**: AWS S3 or compatible service
- **Bucket**: Configured via `BACKUP_S3_BUCKET`
- **Region**: Configured via `BACKUP_S3_REGION`
- **Retention**: 30 days
- **Storage Class**: Standard for recent backups, Glacier for archives
- **Versioning**: Enabled
- **Encryption**: Server-side encryption (SSE-S3)

### Storage Distribution

```
┌─────────────────┐
│  Local Storage  │  ← Fast access, 7 days
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   S3 Standard   │  ← 30 days retention
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   S3 Glacier    │  ← Long-term archive
└─────────────────┘
```

## Security

### Encryption

All backups are encrypted using AES-256-CBC encryption:

1. **Encryption Key**: Stored in `BACKUP_ENCRYPTION_KEY` environment variable
2. **Key Derivation**: scrypt with salt
3. **IV**: Random 16-byte initialization vector per backup
4. **Format**: IV prepended to encrypted data

### Access Control

- Backup files: Read/write only by backup service user
- S3 bucket: IAM role with least privilege
- Encryption keys: Stored in secure secret management system

### Compliance

- GDPR: Encrypted backups, access logging
- SOC 2: Audit trails, retention policies
- PCI DSS: Encryption at rest and in transit

## Backup Schedule

### Automated Schedule

```javascript
// Daily full backup at 2:00 AM UTC
"0 2 * * *" → Full backup

// Incremental backup every 6 hours
"0 */6 * * *" → Incremental backup

// Cleanup old backups daily at 3:00 AM UTC
"0 3 * * *" → Cleanup

// Health check every hour
"0 * * * *" → Health check

// Metrics collection every 15 minutes
"*/15 * * * *" → Metrics
```

### Manual Backups

Manual backups can be triggered via CLI:

```bash
npm run backup create
```

## Verification

### Automated Verification

Every backup is automatically verified after creation:

1. **Checksum Verification**: SHA-256 hash comparison
2. **File Integrity**: Decompression and decryption test
3. **Format Validation**: SQL dump format check
4. **Metadata Validation**: Backup metadata consistency

### Manual Verification

```bash
npm run backup verify <backup-id>
```

### Verification Levels

- **Full**: Complete restore to test database
- **Partial**: Checksum and format validation
- **None**: Skip verification (not recommended)

## Recovery Procedures

### Full Database Restore

```bash
# List available backups
npm run backup list

# Verify backup integrity
npm run backup verify backup_1234567890_abcd

# Restore to current database
npm run backup restore backup_1234567890_abcd

# Restore to different database
npm run backup restore backup_1234567890_abcd --target-db=recovery_db
```

### Partial Restore

Restore specific tables only:

```bash
npm run backup restore-partial backup_1234567890_abcd --tables=assets,bridges,prices
```

### Point-in-Time Recovery

Restore to a specific point in time:

```bash
npm run backup restore backup_1234567890_abcd --point-in-time=2024-03-15T10:30:00Z
```

## Monitoring and Alerts

### Metrics

The following metrics are collected and monitored:

- Total backup count
- Successful/failed backup ratio
- Backup sizes and growth trends
- Verification success rate
- Backup age
- Storage utilization

### Alerts

Alerts are triggered for:

- **Critical**:
  - No backups in last 24 hours
  - No backups exist
  - Backup verification failures

- **Warning**:
  - Low backup count (< 7)
  - Low verification success rate (< 95%)
  - Failed backups detected
  - No offsite backups

- **Info**:
  - Large backup sizes
  - Unencrypted backups
  - Storage threshold warnings

### Health Checks

Automated health checks run hourly:

```bash
# Manual health check
npm run backup-health-check
```

## Retention Policies

### Default Retention

- **Local backups**: 7 days
- **S3 backups**: 30 days
- **Archived backups**: 1 year (Glacier)

### Cleanup Process

Automated cleanup runs daily:

1. Identify backups older than retention period
2. Verify newer backups exist
3. Delete local files
4. Delete S3 objects
5. Update metadata

### Custom Retention

Configure via environment variables:

```bash
BACKUP_RETENTION_DAYS=30
```

## Disaster Recovery

### Recovery Time Objective (RTO)

- **Target**: 4 hours
- **Full restore**: 2-3 hours
- **Partial restore**: 30-60 minutes

### Recovery Point Objective (RPO)

- **Target**: 6 hours
- **With incremental backups**: Up to 6 hours of data loss
- **With WAL archiving**: Near-zero data loss

### DR Scenarios

#### Scenario 1: Database Corruption

1. Stop application services
2. Verify backup integrity
3. Restore from most recent backup
4. Verify data consistency
5. Restart services

#### Scenario 2: Complete Data Loss

1. Provision new database instance
2. Download backup from S3
3. Restore to new instance
4. Update application configuration
5. Verify and restart services

#### Scenario 3: Partial Data Loss

1. Identify affected tables
2. Restore specific tables from backup
3. Verify data integrity
4. Resume operations

## Testing Procedures

### Monthly Recovery Test

1. Select random backup from last 30 days
2. Restore to test database
3. Verify data integrity
4. Run application test suite
5. Document results

### Quarterly DR Drill

1. Simulate complete data loss
2. Execute full recovery procedure
3. Measure RTO and RPO
4. Update procedures based on findings

### Annual Audit

1. Review all backup procedures
2. Test all recovery scenarios
3. Verify compliance requirements
4. Update documentation

## Configuration

### Environment Variables

```bash
# Backup directory
BACKUP_DIR=/var/backups/bridge-watch

# Encryption
BACKUP_ENCRYPTION_KEY=your-secure-encryption-key

# Retention
BACKUP_RETENTION_DAYS=30

# S3 Configuration
BACKUP_S3_BUCKET=bridge-watch-backups
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY=your-access-key
BACKUP_S3_SECRET_KEY=your-secret-key

# Options
BACKUP_VERIFY=true
BACKUP_COMPRESSION=true
```

### Database Configuration

Enable WAL archiving for point-in-time recovery:

```sql
-- postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'
```

## Troubleshooting

### Backup Fails

1. Check disk space: `df -h`
2. Verify database connectivity
3. Check PostgreSQL logs
4. Verify permissions on backup directory

### Restore Fails

1. Verify backup integrity: `npm run backup verify <id>`
2. Check target database exists
3. Verify PostgreSQL version compatibility
4. Check for conflicting data

### S3 Upload Fails

1. Verify AWS credentials
2. Check S3 bucket permissions
3. Verify network connectivity
4. Check S3 bucket region

## Best Practices

1. **Always verify backups** after creation
2. **Test restores regularly** (monthly minimum)
3. **Monitor backup metrics** continuously
4. **Keep encryption keys secure** and backed up separately
5. **Document all recovery procedures**
6. **Maintain offsite backups** for disaster recovery
7. **Automate everything** to reduce human error
8. **Log all backup operations** for audit trails
9. **Set up alerts** for backup failures
10. **Review and update** procedures quarterly

## Support and Escalation

### Backup Issues

- Level 1: Check logs and documentation
- Level 2: Run manual verification
- Level 3: Contact database administrator

### Recovery Issues

- Level 1: Verify backup integrity
- Level 2: Attempt alternative backup
- Level 3: Escalate to disaster recovery team

## References

- PostgreSQL Backup Documentation: https://www.postgresql.org/docs/current/backup.html
- AWS S3 Best Practices: https://docs.aws.amazon.com/AmazonS3/latest/userguide/backup-best-practices.html
- Disaster Recovery Planning: Internal DR documentation
