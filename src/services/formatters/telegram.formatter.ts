import { AlertEvent } from "../telegram.bot.service.js";

/**
 * Escape special characters for Telegram Markdown V2
 * Reference: https://core.telegram.org/bots/api#markdownv2style
 */
export function escapeTelegramMarkdown(text: string): string {
  if (!text) return "";

  // Escape special characters used in markdown v2
  // Characters to escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
  const specialChars = /([_*\[\]()~`>#\+\-=|{}.!])/g;
  return text.replace(specialChars, "\\$1");
}

/**
 * Format alert message for Telegram
 */
export function formatAlertMessage(alert: AlertEvent): string {
  const priorityEmoji: Record<string, string> = {
    critical: "🚨",
    high: "⚠️",
    medium: "📢",
    low: "ℹ️",
  };

  const priorityText = alert.priority.toUpperCase();
  const emoji = priorityEmoji[alert.priority] || "🔔";

  // Escape all user-provided fields
  const safeMeasure = escapeTelegramMarkdown(alert.metric);
  const safeAsset = escapeTelegramMarkdown(alert.assetCode);
  const safeTriggeredValue = escapeTelegramMarkdown(
    String(alert.triggeredValue)
  );
  const safeThreshold = escapeTelegramMarkdown(String(alert.threshold));
  const safeRuleId = escapeTelegramMarkdown(alert.ruleId);

  const timestamp = new Date(alert.time).toISOString();

  const message =
    `${emoji} *${priorityText} ALERT*\n\n` +
    `*Metric:* ${safeMeasure}\n` +
    `*Asset:* ${safeAsset}\n` +
    `*Triggered Value:* \`${safeTriggeredValue}\`\n` +
    `*Threshold:* \`${safeThreshold}\`\n` +
    `*Alert ID:* \`${safeRuleId}\`\n` +
    `*Time:* ${escapeTelegramMarkdown(timestamp)}\n\n` +
    `[View Details](https://bridge\\-watch\\.example\\.com/alerts/${safeRuleId})`;

  return ensureMessageLength(message);
}

/**
 * Format status message for Telegram
 */
export function formatStatusMessage(metrics: {
  health: string;
  activeAlerts: number;
  subscribers: number;
  lastCheck: Date;
}): string {
  return (
    `📊 *System Status*\n\n` +
    `Health: ${escapeTelegramMarkdown(metrics.health)}\n` +
    `Active Alerts \\(24h\\): ${metrics.activeAlerts}\n` +
    `Subscribers: ${metrics.subscribers}\n` +
    `Last Check: ${escapeTelegramMarkdown(metrics.lastCheck.toLocaleTimeString())}\n\n` +
    `[Dashboard](https://bridge\\-watch\\.example\\.com/dashboard)`
  );
}

/**
 * Ensure message doesn't exceed Telegram's 4096 character limit
 */
function ensureMessageLength(message: string): string {
  const maxLength = 4096;

  if (message.length <= maxLength) {
    return message;
  }

  // Truncate and add ellipsis
  return message.substring(0, maxLength - 18) + "\n…\\[truncated\\]";
}

/**
 * Format multi-line list of alerts for Telegram
 */
export function formatAlertList(alerts: AlertEvent[]): string {
  if (alerts.length === 0) {
    return `*No recent alerts* ✅`;
  }

  let message = `*Recent Alerts* 🚨\n`;
  message += `_Latest ${Math.min(alerts.length, 10)} of ${alerts.length}_\n\n`;

  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  // Sort by severity (highest first)
  const sorted = [...alerts].sort(
    (a, b) =>
      (severityOrder[a.priority] || 99) - (severityOrder[b.priority] || 99)
  );

  for (let i = 0; i < Math.min(sorted.length, 10); i++) {
    const alert = sorted[i];
    const emoji =
      alert.priority === "critical"
        ? "🔴"
        : alert.priority === "high"
          ? "🟠"
          : alert.priority === "medium"
            ? "🟡"
            : "🟢";

    const metric = escapeTelegramMarkdown(alert.metric).substring(0, 30);
    const asset = escapeTelegramMarkdown(alert.assetCode);
    const time = new Date(alert.time).toLocaleTimeString();

    message += `${emoji} ${metric} \\(${asset}\\)\n`;
    message += `   _${time}_\n`;
  }

  return ensureMessageLength(message);
}
