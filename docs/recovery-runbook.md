# Database Recovery Runbook

## Purpose

This runbook provides step-by-step procedures for recovering the Stellar Bridge Watch database from backups in various failure scenarios.

## Prerequisites

- Access to backup CLI: `npm run backup`
- Database credentials with restore permissions
- Access to S3 bucket (if using offsite backups)
- Backup encryption key (if backups are encrypted)

## Quick Reference

| Scenario                | Estimated Time | Complexity | Data Loss     |
| ----------------------- | -------------- | ---------- | ------------- |
| Single table corruption | 15-30 min      | Low        | Minimal       |
| Database corruption     | 1-2 hours      | Medium     | Up to 6 hours |
| Complete data loss      | 2-4 hours      | High       | Up to 6 hours |
| Point-in-time recovery  | 2-3 hours      | High       | Controlled    |

## Emergency Contacts

- **Database Administrator**: [Contact Info]
- **DevOps Lead**: [Contact Info]
- **On-Call Engineer**: [Contact Info]
- **Backup System**: backup-alerts@company.com

---

## Scenario 1: Single Table Corruption

### Symptoms

- Specific table returns errors
- Data inconsistencies in one table
- Application errors related to specific table

### Impact

- **Severity**: Medium
- **Affected**: Specific functionality
- **Downtime**: Minimal (5-15 minutes)

### Recovery Steps

#### Step 1: Assess the Damage

```bash
# Connect to database
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB

# Check table
SELECT COUNT(*) FROM affected_table;
SELECT * FROM affected_table LIMIT 10;

# Check for errors
\d affected_table
```

#### Step 2: Identify Backup

```bash
# List available backups
npm run backup list

# Get most recent backup info
npm run backup info <backup-id>
```

#### Step 3: Verify Backup

```bash
# Verify backup integrity
npm run backup verify <backup-id>
```

#### Step 4: Create Safety Backup

```bash
# Backup current state before restore
pg_dump -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -t affected_table > /tmp/affected_table_before_restore.sql
```

#### Step 5: Restore Table

```bash
# Restore specific table
npm run backup restore-partial <backup-id> --tables=affected_table
```

#### Step 6: Verify Restoration

```bash
# Check table data
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT COUNT(*) FROM affected_table;"

# Run application tests
npm test -- --grep "affected_table"
```

#### Step 7: Resume Operations

```bash
# Clear application cache if needed
redis-cli FLUSHDB

# Restart application services
pm2 restart all
```

### Rollback Procedure

If restore causes issues:

```bash
# Restore from safety backup
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB < /tmp/affected_table_before_restore.sql
```

---

## Scenario 2: Database Corruption

### Symptoms

- Multiple tables affected
- Database connection errors
- Widespread data inconsistencies
- PostgreSQL errors in logs

### Impact

- **Severity**: High
- **Affected**: Entire application
- **Downtime**: 1-2 hours

### Recovery Steps

#### Step 1: Declare Incident

```bash
# Notify team
echo "Database corruption detected at $(date)" | mail -s "CRITICAL: Database Incident" team@company.com

# Update status page
# Set application to maintenance mode
```

#### Step 2: Stop Application Services

```bash
# Stop all application services
pm2 stop all

# Stop workers
pm2 stop workers

# Verify no connections to database
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d postgres -c "SELECT COUNT(*) FROM pg_stat_activity WHERE datname='$POSTGRES_DB';"
```

#### Step 3: Assess Database State

```bash
# Check database integrity
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT pg_database_size('$POSTGRES_DB');"

# Check for corruption
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "VACUUM FULL ANALYZE;"

# Export error logs
tail -n 1000 /var/log/postgresql/postgresql.log > /tmp/db_errors_$(date +%Y%m%d_%H%M%S).log
```

#### Step 4: Select Backup

```bash
# List recent backups
npm run backup list

# Verify most recent successful backup
npm run backup verify <backup-id>

# If verification fails, try previous backup
npm run backup verify <previous-backup-id>
```

#### Step 5: Create Recovery Database

```bash
# Create recovery database
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d postgres -c "CREATE DATABASE bridge_watch_recovery;"

# Restore to recovery database first
npm run backup restore <backup-id> --target-db=bridge_watch_recovery
```

#### Step 6: Verify Recovery Database

```bash
# Check database size
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d bridge_watch_recovery -c "SELECT pg_database_size('bridge_watch_recovery');"

# Check table counts
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d bridge_watch_recovery -c "
SELECT
  schemaname,
  tablename,
  n_live_tup as row_count
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
"

# Run data integrity checks
npm run test:integration -- --db=bridge_watch_recovery
```

#### Step 7: Switch to Recovery Database

```bash
# Rename databases
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d postgres << EOF
-- Terminate connections to original database
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();

-- Rename original database
ALTER DATABASE $POSTGRES_DB RENAME TO bridge_watch_corrupted_$(date +%Y%m%d);

-- Rename recovery database
ALTER DATABASE bridge_watch_recovery RENAME TO $POSTGRES_DB;
EOF
```

#### Step 8: Restart Services

```bash
# Start application services
pm2 start all

# Monitor logs
pm2 logs --lines 100

# Check application health
curl http://localhost:3001/health
```

#### Step 9: Verify Application

```bash
# Run smoke tests
npm run test:smoke

# Check critical endpoints
curl http://localhost:3001/api/assets
curl http://localhost:3001/api/bridges

# Monitor error rates
# Check application metrics dashboard
```

#### Step 10: Post-Recovery

```bash
# Document incident
# Update incident log with timeline
# Schedule post-mortem meeting

# Keep corrupted database for analysis
# Can be dropped after investigation:
# psql -h $POSTGRES_HOST -U $POSTGRES_USER -d postgres -c "DROP DATABASE bridge_watch_corrupted_YYYYMMDD;"
```

### Rollback Procedure

If recovery database has issues:

```bash
# Rename back to original
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d postgres << EOF
ALTER DATABASE $POSTGRES_DB RENAME TO bridge_watch_failed_recovery;
ALTER DATABASE bridge_watch_corrupted_YYYYMMDD RENAME TO $POSTGRES_DB;
EOF

# Try alternative backup
npm run backup restore <alternative-backup-id> --target-db=bridge_watch_recovery2
```

---

## Scenario 3: Complete Data Loss

### Symptoms

- Database server failure
- Storage failure
- Accidental database drop
- Ransomware attack

### Impact

- **Severity**: Critical
- **Affected**: Entire system
- **Downtime**: 2-4 hours

### Recovery Steps

#### Step 1: Activate Disaster Recovery

```bash
# Activate DR team
# Notify stakeholders
# Update status page: "System down for emergency maintenance"

# Document incident start time
echo "DR activated at $(date)" >> /var/log/dr_incident.log
```

#### Step 2: Provision New Database

```bash
# If using cloud provider, provision new RDS/database instance
# If on-premises, prepare new database server

# Initialize PostgreSQL
sudo -u postgres initdb -D /var/lib/postgresql/data

# Start PostgreSQL
sudo systemctl start postgresql

# Create database and user
psql -U postgres << EOF
CREATE USER bridge_watch WITH PASSWORD 'secure_password';
CREATE DATABASE bridge_watch OWNER bridge_watch;
GRANT ALL PRIVILEGES ON DATABASE bridge_watch TO bridge_watch;
EOF
```

#### Step 3: Retrieve Backup from S3

```bash
# List S3 backups
aws s3 ls s3://$BACKUP_S3_BUCKET/backups/ --recursive

# Download most recent backup
aws s3 cp s3://$BACKUP_S3_BUCKET/backups/<backup-file> /tmp/

# Verify download
sha256sum /tmp/<backup-file>
```

#### Step 4: Restore Database

```bash
# If backup is encrypted and compressed
# Decrypt
openssl enc -d -aes-256-cbc -in /tmp/<backup-file>.enc -out /tmp/<backup-file>.gz -k $BACKUP_ENCRYPTION_KEY

# Decompress
gunzip /tmp/<backup-file>.gz

# Restore
psql -h $POSTGRES_HOST -U bridge_watch -d bridge_watch -f /tmp/<backup-file>
```

#### Step 5: Verify Database

```bash
# Check database size
psql -h $POSTGRES_HOST -U bridge_watch -d bridge_watch -c "SELECT pg_database_size('bridge_watch');"

# Verify table counts
psql -h $POSTGRES_HOST -U bridge_watch -d bridge_watch -c "
SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = 'public';
"

# Check critical tables
psql -h $POSTGRES_HOST -U bridge_watch -d bridge_watch -c "
SELECT 'assets' as table_name, COUNT(*) as row_count FROM assets
UNION ALL
SELECT 'bridges', COUNT(*) FROM bridges
UNION ALL
SELECT 'prices', COUNT(*) FROM prices;
"
```

#### Step 6: Update Configuration

```bash
# Update database connection strings
# Update .env file with new database host/credentials

# Update DNS if needed
# Update load balancer configuration
```

#### Step 7: Restore Application State

```bash
# Run migrations if needed
npm run migrate

# Seed reference data if needed
npm run seed

# Clear Redis cache
redis-cli FLUSHALL
```

#### Step 8: Start Services

```bash
# Start workers
pm2 start ecosystem.config.js --only workers

# Start API
pm2 start ecosystem.config.js --only api

# Monitor startup
pm2 logs --lines 200
```

#### Step 9: Verify System

```bash
# Health checks
curl http://localhost:3001/health
curl http://localhost:3001/api/assets

# Run integration tests
npm run test:integration

# Check monitoring dashboards
# Verify metrics are being collected
```

#### Step 10: Resume Operations

```bash
# Update status page: "System operational"
# Notify stakeholders
# Monitor for 24 hours

# Schedule post-mortem
# Document lessons learned
```

---

## Scenario 4: Point-in-Time Recovery

### Use Case

- Recover to state before bad deployment
- Undo accidental data deletion
- Investigate historical data

### Recovery Steps

#### Step 1: Identify Target Time

```bash
# Determine exact time to recover to
TARGET_TIME="2024-03-15T10:30:00Z"

# Find backup before target time
npm run backup list | grep -B5 "$TARGET_TIME"
```

#### Step 2: Create Recovery Database

```bash
# Create separate database for PITR
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d postgres -c "CREATE DATABASE bridge_watch_pitr;"
```

#### Step 3: Restore Base Backup

```bash
# Restore base backup
npm run backup restore <backup-id> --target-db=bridge_watch_pitr
```

#### Step 4: Apply WAL Files

```bash
# If WAL archiving is enabled
# Copy WAL files to recovery location
cp /var/lib/postgresql/wal_archive/* /var/lib/postgresql/pitr_wal/

# Configure recovery
cat > /var/lib/postgresql/data/recovery.conf << EOF
restore_command = 'cp /var/lib/postgresql/pitr_wal/%f %p'
recovery_target_time = '$TARGET_TIME'
recovery_target_action = 'promote'
EOF

# Start recovery
sudo systemctl restart postgresql
```

#### Step 5: Verify Recovery Point

```bash
# Check recovery time
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d bridge_watch_pitr -c "SELECT pg_last_xact_replay_timestamp();"

# Verify data at target time
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d bridge_watch_pitr -c "SELECT * FROM your_table WHERE timestamp <= '$TARGET_TIME';"
```

#### Step 6: Extract Required Data

```bash
# Export specific data
pg_dump -h $POSTGRES_HOST -U $POSTGRES_USER -d bridge_watch_pitr -t specific_table > /tmp/recovered_data.sql

# Or copy specific rows
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d bridge_watch_pitr -c "COPY (SELECT * FROM table WHERE condition) TO '/tmp/recovered_data.csv' CSV HEADER;"
```

#### Step 7: Import to Production

```bash
# Import recovered data
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d bridge_watch < /tmp/recovered_data.sql

# Or merge specific data
# Use application logic to merge data carefully
```

---

## Verification Checklist

After any recovery, verify:

- [ ] Database is accessible
- [ ] All tables exist
- [ ] Row counts match expectations
- [ ] Application can connect
- [ ] Critical queries work
- [ ] No error logs
- [ ] Monitoring is active
- [ ] Backups are running
- [ ] Application tests pass
- [ ] User acceptance testing

## Common Issues and Solutions

### Issue: Backup verification fails

**Solution:**

```bash
# Try previous backup
npm run backup list
npm run backup verify <previous-backup-id>

# Check backup file integrity
sha256sum /path/to/backup/file
```

### Issue: Restore fails with permission errors

**Solution:**

```bash
# Grant necessary permissions
psql -h $POSTGRES_HOST -U postgres -d bridge_watch -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO bridge_watch;"
psql -h $POSTGRES_HOST -U postgres -d bridge_watch -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO bridge_watch;"
```

### Issue: Application can't connect after restore

**Solution:**

```bash
# Check connection settings
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1;"

# Verify pg_hba.conf
sudo cat /etc/postgresql/*/main/pg_hba.conf

# Restart PostgreSQL
sudo systemctl restart postgresql
```

### Issue: Data inconsistencies after restore

**Solution:**

```bash
# Run VACUUM and ANALYZE
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "VACUUM FULL ANALYZE;"

# Rebuild indexes
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "REINDEX DATABASE bridge_watch;"

# Update statistics
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "ANALYZE;"
```

## Post-Recovery Actions

1. **Document the incident**
   - Timeline of events
   - Actions taken
   - Lessons learned

2. **Update monitoring**
   - Add alerts for similar issues
   - Improve detection

3. **Review backup strategy**
   - Adjust retention if needed
   - Improve backup frequency

4. **Test recovery procedures**
   - Schedule recovery drill
   - Update runbook

5. **Communicate**
   - Notify stakeholders
   - Update documentation
   - Share lessons learned

## Testing This Runbook

### Monthly Test

```bash
# Test partial restore
npm run backup restore-partial <recent-backup> --tables=test_table --target-db=test_recovery

# Verify
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d test_recovery -c "SELECT COUNT(*) FROM test_table;"

# Cleanup
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d postgres -c "DROP DATABASE test_recovery;"
```

### Quarterly DR Drill

Follow Scenario 3 (Complete Data Loss) in a test environment.

## Appendix

### Useful Commands

```bash
# Check database size
psql -c "SELECT pg_size_pretty(pg_database_size('bridge_watch'));"

# List all tables with sizes
psql -c "SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"

# Check active connections
psql -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'bridge_watch';"

# Kill all connections
psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'bridge_watch' AND pid <> pg_backend_pid();"
```

### Contact Information

- **Backup System Logs**: `/var/log/backup/`
- **PostgreSQL Logs**: `/var/log/postgresql/`
- **Application Logs**: `pm2 logs`
- **Monitoring Dashboard**: [URL]
- **Status Page**: [URL]

---

**Last Updated**: 2024-03-15  
**Version**: 1.0  
**Owner**: DevOps Team
