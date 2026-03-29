# Backup System Quick Reference

## Common Commands

### Create Backup

```bash
npm run backup:create
```

### List All Backups

```bash
npm run backup:list
```

### Verify Backup

```bash
npm run backup verify <backup-id>
```

### Get Backup Info

```bash
npm run backup info <backup-id>
```

### Restore Full Database

```bash
npm run backup restore <backup-id>
```

### Restore to Different Database

```bash
npm run backup restore <backup-id> --target-db=recovery_db
```

### Restore Specific Tables

```bash
npm run backup restore-partial <backup-id> --tables=assets,bridges,prices
```

### Point-in-Time Recovery

```bash
npm run backup restore <backup-id> --point-in-time=2024-03-15T10:30:00Z
```

### Delete Backup

```bash
npm run backup delete <backup-id>
```

### Cleanup Old Backups

```bash
npm run backup:cleanup
```

## Emergency Recovery

### Quick Recovery Steps

1. **Stop Application**

   ```bash
   pm2 stop all
   ```

2. **List Available Backups**

   ```bash
   npm run backup:list
   ```

3. **Verify Backup**

   ```bash
   npm run backup verify <backup-id>
   ```

4. **Restore Database**

   ```bash
   npm run backup restore <backup-id>
   ```

5. **Verify Data**

   ```bash
   psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT COUNT(*) FROM assets;"
   ```

6. **Restart Application**
   ```bash
   pm2 start all
   ```

## Configuration

### Required Environment Variables

```bash
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=30
```

### Optional but Recommended

```bash
BACKUP_ENCRYPTION_KEY=your-secure-key
BACKUP_VERIFY=true
BACKUP_COMPRESSION=true
```

### S3 Configuration (Optional)

```bash
BACKUP_S3_BUCKET=bridge-watch-backups
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY=your-access-key
BACKUP_S3_SECRET_KEY=your-secret-key
```

## Backup Schedule

| Job          | Schedule       | Description              |
| ------------ | -------------- | ------------------------ |
| Full Backup  | Daily 2 AM UTC | Complete database backup |
| Incremental  | Every 6 hours  | Point-in-time recovery   |
| Cleanup      | Daily 3 AM UTC | Remove old backups       |
| Health Check | Every hour     | System health monitoring |
| Metrics      | Every 15 min   | Metrics collection       |

## Troubleshooting

### Backup Fails

```bash
# Check disk space
df -h

# Check permissions
ls -la ./backups

# Check database connection
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1;"
```

### Restore Fails

```bash
# Terminate database connections
psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$POSTGRES_DB';"

# Verify backup integrity
npm run backup verify <backup-id>

# Try previous backup
npm run backup:list
npm run backup restore <previous-backup-id>
```

### S3 Upload Fails

```bash
# Test AWS credentials
aws s3 ls s3://$BACKUP_S3_BUCKET

# Check IAM permissions
# Ensure s3:PutObject, s3:GetObject, s3:DeleteObject permissions
```

## Monitoring

### Check Backup Health

```bash
# View recent backups
npm run backup:list | head -n 10

# Check backup sizes
du -sh ./backups/*

# View logs
tail -f /var/log/backup.log
```

### Metrics to Monitor

- Last backup timestamp (should be < 24 hours)
- Backup success rate (should be > 95%)
- Backup size trends
- Storage utilization
- Verification success rate

## Security Checklist

- [ ] Encryption key configured
- [ ] Encryption key stored securely
- [ ] S3 bucket has versioning enabled
- [ ] S3 bucket has encryption enabled
- [ ] IAM roles use least privilege
- [ ] Backup directory has correct permissions
- [ ] Access logs enabled
- [ ] Regular security audits scheduled

## Recovery Time Objectives

| Scenario            | RTO       | RPO       |
| ------------------- | --------- | --------- |
| Single table        | 15-30 min | 6 hours   |
| Database corruption | 1-2 hours | 6 hours   |
| Complete data loss  | 2-4 hours | 6 hours   |
| Point-in-time       | 2-3 hours | Near-zero |

## Support Contacts

- **Database Issues**: DBA Team
- **Backup System**: DevOps Team
- **Emergency**: On-Call Engineer
- **Documentation**: [backup-strategy.md](./backup-strategy.md)

## Quick Links

- [Full Documentation](./BACKUP_README.md)
- [Recovery Runbook](./recovery-runbook.md)
- [Backup Strategy](./backup-strategy.md)
- [API Reference](./backup-strategy.md#api-reference)

## Testing

### Monthly Test

```bash
# Create test database
createdb test_restore

# Restore to test database
npm run backup restore <recent-backup> --target-db=test_restore

# Verify data
psql -d test_restore -c "SELECT COUNT(*) FROM assets;"

# Cleanup
dropdb test_restore
```

### Verify Automated Backups

```bash
# Check last backup
npm run backup:list | head -n 2

# Should show backup from last 24 hours
```

## Best Practices

1. ✅ Verify backups after creation
2. ✅ Test restores monthly
3. ✅ Monitor backup metrics
4. ✅ Keep encryption keys secure
5. ✅ Maintain offsite backups
6. ✅ Document all procedures
7. ✅ Set up alerts
8. ✅ Review quarterly
9. ✅ Automate everything
10. ✅ Log all operations

## File Locations

- **Backups**: `./backups/` (or `$BACKUP_DIR`)
- **Metadata**: `./backups/metadata.json`
- **Logs**: Application logs via pino
- **Config**: `.env` file
- **Documentation**: `backend/docs/`

## Backup File Format

```
backup_<timestamp>_<random>.sql[.gz][.enc]
```

Example:

```
backup_1710504000000_a1b2c3d4.sql.gz.enc
```

- `.sql` - PostgreSQL dump
- `.gz` - Compressed (if enabled)
- `.enc` - Encrypted (if enabled)

## PostgreSQL Commands

### Check Database Size

```bash
psql -c "SELECT pg_size_pretty(pg_database_size('bridge_watch'));"
```

### List Tables with Sizes

```bash
psql -c "SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

### Check Active Connections

```bash
psql -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'bridge_watch';"
```

### Terminate All Connections

```bash
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'bridge_watch' AND pid <> pg_backend_pid();"
```

---

**Last Updated**: 2024-03-15  
**Version**: 1.0
