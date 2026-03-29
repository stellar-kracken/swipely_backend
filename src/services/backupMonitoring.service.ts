import { BackupService, BackupMetadata } from "./backup.service.js";
import { logger } from "../utils/logger.js";

export interface BackupMetrics {
  totalBackups: number;
  successfulBackups: number;
  failedBackups: number;
  totalSize: number;
  averageSize: number;
  oldestBackup: Date | null;
  newestBackup: Date | null;
  backupsLast24h: number;
  backupsLast7d: number;
  verificationSuccessRate: number;
  localBackups: number;
  s3Backups: number;
  encryptedBackups: number;
  compressedBackups: number;
}

export interface BackupAlert {
  severity: "critical" | "warning" | "info";
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export class BackupMonitoringService {
  private backupService: BackupService;
  private alertThresholds = {
    maxBackupAge: 24 * 60 * 60 * 1000, // 24 hours
    minSuccessRate: 0.95, // 95%
    maxBackupSize: 10 * 1024 * 1024 * 1024, // 10 GB
    minBackupCount: 7, // At least 7 backups
  };

  constructor(backupService?: BackupService) {
    this.backupService = backupService || new BackupService();
  }

  /**
   * Collect backup metrics
   */
  async collectMetrics(): Promise<BackupMetrics> {
    const backups = await this.backupService.listBackups();

    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const last7d = now - 7 * 24 * 60 * 60 * 1000;

    const successfulBackups = backups.filter((b) => b.status === "completed");
    const failedBackups = backups.filter((b) => b.status === "failed");
    const verifiedBackups = backups.filter((b) => b.verificationStatus === "passed");

    const totalSize = backups.reduce((sum, b) => sum + b.size, 0);
    const averageSize = backups.length > 0 ? totalSize / backups.length : 0;

    const timestamps = backups.map((b) => b.timestamp.getTime());
    const oldestBackup = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
    const newestBackup = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;

    const backupsLast24h = backups.filter((b) => b.timestamp.getTime() > last24h).length;
    const backupsLast7d = backups.filter((b) => b.timestamp.getTime() > last7d).length;

    const verificationSuccessRate =
      verifiedBackups.length > 0 ? verifiedBackups.length / backups.length : 0;

    const localBackups = backups.filter((b) => b.location === "local" || b.location === "both").length;
    const s3Backups = backups.filter((b) => b.location === "s3" || b.location === "both").length;
    const encryptedBackups = backups.filter((b) => b.encrypted).length;
    const compressedBackups = backups.filter((b) => b.compressed).length;

    return {
      totalBackups: backups.length,
      successfulBackups: successfulBackups.length,
      failedBackups: failedBackups.length,
      totalSize,
      averageSize,
      oldestBackup,
      newestBackup,
      backupsLast24h,
      backupsLast7d,
      verificationSuccessRate,
      localBackups,
      s3Backups,
      encryptedBackups,
      compressedBackups,
    };
  }

  /**
   * Check backup health and generate alerts
   */
  async checkBackupHealth(): Promise<BackupAlert[]> {
    const alerts: BackupAlert[] = [];
    const metrics = await this.collectMetrics();
    const backups = await this.backupService.listBackups();

    // Check if backups are too old
    if (metrics.newestBackup) {
      const backupAge = Date.now() - metrics.newestBackup.getTime();
      if (backupAge > this.alertThresholds.maxBackupAge) {
        alerts.push({
          severity: "critical",
          message: `No recent backups. Last backup was ${Math.floor(backupAge / (60 * 60 * 1000))} hours ago`,
          timestamp: new Date(),
          metadata: { lastBackup: metrics.newestBackup, ageHours: backupAge / (60 * 60 * 1000) },
        });
      }
    } else {
      alerts.push({
        severity: "critical",
        message: "No backups found in the system",
        timestamp: new Date(),
      });
    }

    // Check backup count
    if (metrics.totalBackups < this.alertThresholds.minBackupCount) {
      alerts.push({
        severity: "warning",
        message: `Low backup count: ${metrics.totalBackups} (minimum recommended: ${this.alertThresholds.minBackupCount})`,
        timestamp: new Date(),
        metadata: { count: metrics.totalBackups, minimum: this.alertThresholds.minBackupCount },
      });
    }

    // Check success rate
    if (metrics.verificationSuccessRate < this.alertThresholds.minSuccessRate) {
      alerts.push({
        severity: "warning",
        message: `Low backup verification success rate: ${(metrics.verificationSuccessRate * 100).toFixed(1)}%`,
        timestamp: new Date(),
        metadata: { successRate: metrics.verificationSuccessRate },
      });
    }

    // Check for failed backups
    if (metrics.failedBackups > 0) {
      alerts.push({
        severity: "warning",
        message: `${metrics.failedBackups} failed backup(s) detected`,
        timestamp: new Date(),
        metadata: { failedCount: metrics.failedBackups },
      });
    }

    // Check backup sizes
    const largeBackups = backups.filter((b) => b.size > this.alertThresholds.maxBackupSize);
    if (largeBackups.length > 0) {
      alerts.push({
        severity: "info",
        message: `${largeBackups.length} backup(s) exceed size threshold`,
        timestamp: new Date(),
        metadata: {
          count: largeBackups.length,
          threshold: this.alertThresholds.maxBackupSize,
          backups: largeBackups.map((b) => ({ id: b.id, size: b.size })),
        },
      });
    }

    // Check for unencrypted backups
    const unencryptedCount = metrics.totalBackups - metrics.encryptedBackups;
    if (unencryptedCount > 0) {
      alerts.push({
        severity: "info",
        message: `${unencryptedCount} unencrypted backup(s) found`,
        timestamp: new Date(),
        metadata: { unencryptedCount },
      });
    }

    // Check offsite backup status
    if (metrics.s3Backups === 0 && metrics.totalBackups > 0) {
      alerts.push({
        severity: "warning",
        message: "No offsite (S3) backups configured",
        timestamp: new Date(),
      });
    }

    return alerts;
  }

  /**
   * Generate backup status report
   */
  async generateStatusReport(): Promise<string> {
    const metrics = await this.collectMetrics();
    const alerts = await this.checkBackupHealth();

    let report = "=== Backup System Status Report ===\n\n";
    report += `Generated: ${new Date().toISOString()}\n\n`;

    report += "--- Backup Statistics ---\n";
    report += `Total Backups: ${metrics.totalBackups}\n`;
    report += `Successful: ${metrics.successfulBackups}\n`;
    report += `Failed: ${metrics.failedBackups}\n`;
    report += `Total Size: ${(metrics.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
    report += `Average Size: ${(metrics.averageSize / 1024 / 1024).toFixed(2)} MB\n`;
    report += `Oldest Backup: ${metrics.oldestBackup?.toISOString() || "N/A"}\n`;
    report += `Newest Backup: ${metrics.newestBackup?.toISOString() || "N/A"}\n`;
    report += `Backups (24h): ${metrics.backupsLast24h}\n`;
    report += `Backups (7d): ${metrics.backupsLast7d}\n`;
    report += `Verification Success Rate: ${(metrics.verificationSuccessRate * 100).toFixed(1)}%\n\n`;

    report += "--- Storage Distribution ---\n";
    report += `Local: ${metrics.localBackups}\n`;
    report += `S3: ${metrics.s3Backups}\n`;
    report += `Encrypted: ${metrics.encryptedBackups}\n`;
    report += `Compressed: ${metrics.compressedBackups}\n\n`;

    if (alerts.length > 0) {
      report += "--- Alerts ---\n";
      for (const alert of alerts) {
        report += `[${alert.severity.toUpperCase()}] ${alert.message}\n`;
      }
    } else {
      report += "--- Alerts ---\n";
      report += "No alerts. System is healthy.\n";
    }

    return report;
  }

  /**
   * Log metrics to monitoring system
   */
  async logMetrics(): Promise<void> {
    const metrics = await this.collectMetrics();
    
    logger.info(
      {
        backup_metrics: {
          total_backups: metrics.totalBackups,
          successful_backups: metrics.successfulBackups,
          failed_backups: metrics.failedBackups,
          total_size_gb: metrics.totalSize / 1024 / 1024 / 1024,
          backups_24h: metrics.backupsLast24h,
          backups_7d: metrics.backupsLast7d,
          verification_success_rate: metrics.verificationSuccessRate,
          encrypted_backups: metrics.encryptedBackups,
          s3_backups: metrics.s3Backups,
        },
      },
      "Backup metrics collected"
    );
  }

  /**
   * Send alerts to monitoring system
   */
  async sendAlerts(alerts: BackupAlert[]): Promise<void> {
    for (const alert of alerts) {
      logger[alert.severity === "critical" ? "error" : alert.severity === "warning" ? "warn" : "info"](
        {
          alert_type: "backup_health",
          severity: alert.severity,
          message: alert.message,
          metadata: alert.metadata,
        },
        `Backup alert: ${alert.message}`
      );
    }
  }

  /**
   * Run health check and send alerts
   */
  async runHealthCheck(): Promise<void> {
    logger.info("Running backup health check");

    try {
      const alerts = await this.checkBackupHealth();
      
      if (alerts.length > 0) {
        await this.sendAlerts(alerts);
      }

      await this.logMetrics();

      logger.info({ alertCount: alerts.length }, "Backup health check completed");
    } catch (error) {
      logger.error({ error }, "Backup health check failed");
      throw error;
    }
  }
}
