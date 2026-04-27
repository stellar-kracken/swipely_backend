import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

type EmailTemplateType = "alert" | "digest";
type EmailDeliveryStatus =
  | "queued"
  | "processing"
  | "sent"
  | "failed"
  | "bounced"
  | "unsubscribed"
  | "rate_limited";

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailAlertPayload {
  alertType: string;
  severity: "low" | "medium" | "high" | "critical";
  assetCode: string;
  message: string;
  triggeredAt: string;
  metadata?: Record<string, unknown>;
}

export interface EmailDigestItem {
  title: string;
  summary: string;
  timestamp: string;
}

export interface EmailDigestPayload {
  periodLabel: string;
  generatedAt: string;
  items: EmailDigestItem[];
}

export interface EmailTemplateContext {
  unsubscribeUrl?: string;
  recipientName?: string;
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface EmailQueueItem {
  id: string;
  templateType: EmailTemplateType;
  recipient: EmailRecipient;
  payload: EmailAlertPayload | EmailDigestPayload;
  context?: EmailTemplateContext;
  status: EmailDeliveryStatus;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt?: Date;
}

type TemplateRenderer<TPayload> = (
  payload: TPayload,
  context: EmailTemplateContext
) => EmailTemplate;

interface DeliveryStats {
  queued: number;
  sent: number;
  failed: number;
  bounced: number;
  unsubscribed: number;
  rateLimited: number;
}

interface RateLimitConfig {
  maxPerMinute: number;
  windowMs: number;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxPerMinute: 120,
  windowMs: 60_000,
};

export class EmailNotificationService {
  private transporter: Transporter | null = null;
  private readonly queue: EmailQueueItem[] = [];
  private readonly tracking = new Map<string, EmailQueueItem>();
  private readonly unsubscribedEmails = new Set<string>();
  private readonly bouncedEmails = new Set<string>();
  private readonly recentDeliveryTimestamps: number[] = [];
  private readonly templates = new Map<
    EmailTemplateType,
    TemplateRenderer<EmailAlertPayload | EmailDigestPayload>
  >();
  private processing = false;
  private readonly maxAttempts = 3;
  private readonly rateLimit: RateLimitConfig;

  constructor(rateLimit: Partial<RateLimitConfig> = {}) {
    this.rateLimit = {
      maxPerMinute: rateLimit.maxPerMinute ?? DEFAULT_RATE_LIMIT.maxPerMinute,
      windowMs: rateLimit.windowMs ?? DEFAULT_RATE_LIMIT.windowMs,
    };

    this.registerDefaultTemplates();
  }

  /**
   * Registers or replaces a template renderer.
   * Built-in templates:
   * - "alert": high-priority event notifications
   * - "digest": periodic report for subscribers
   */
  registerTemplate<TPayload extends EmailAlertPayload | EmailDigestPayload>(
    templateType: EmailTemplateType,
    renderer: TemplateRenderer<TPayload>
  ): void {
    this.templates.set(
      templateType,
      renderer as TemplateRenderer<EmailAlertPayload | EmailDigestPayload>
    );
  }

  async sendAlertEmail(
    recipient: EmailRecipient,
    payload: EmailAlertPayload,
    context: EmailTemplateContext = {}
  ): Promise<string> {
    return this.enqueue("alert", recipient, payload, context);
  }

  async sendDigestEmail(
    recipient: EmailRecipient,
    payload: EmailDigestPayload,
    context: EmailTemplateContext = {}
  ): Promise<string> {
    return this.enqueue("digest", recipient, payload, context);
  }

  async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) {
          continue;
        }
        await this.processQueueItem(item);
      }
    } finally {
      this.processing = false;
    }
  }

  async verifyProviderConnection(): Promise<boolean> {
    const transporter = this.getTransporter();
    if (!transporter) {
      return false;
    }

    try {
      await transporter.verify();
      logger.info("Email provider verified");
      return true;
    } catch (error) {
      logger.error({ error }, "Email provider verification failed");
      return false;
    }
  }

  markBounced(email: string): void {
    const normalized = this.normalizeEmail(email);
    this.bouncedEmails.add(normalized);
    logger.warn({ email: normalized }, "Email marked as bounced");
  }

  unsubscribe(email: string): void {
    const normalized = this.normalizeEmail(email);
    this.unsubscribedEmails.add(normalized);
    logger.info({ email: normalized }, "Email unsubscribed");
  }

  isUnsubscribed(email: string): boolean {
    return this.unsubscribedEmails.has(this.normalizeEmail(email));
  }

  isBounced(email: string): boolean {
    return this.bouncedEmails.has(this.normalizeEmail(email));
  }

  getDeliveryStatus(messageId: string): EmailQueueItem | null {
    return this.tracking.get(messageId) ?? null;
  }

  getStats(): DeliveryStats {
    const stats: DeliveryStats = {
      queued: 0,
      sent: 0,
      failed: 0,
      bounced: 0,
      unsubscribed: 0,
      rateLimited: 0,
    };

    for (const item of this.tracking.values()) {
      if (item.status === "queued" || item.status === "processing") {
        stats.queued += 1;
      } else if (item.status === "sent") {
        stats.sent += 1;
      } else if (item.status === "failed") {
        stats.failed += 1;
      } else if (item.status === "bounced") {
        stats.bounced += 1;
      } else if (item.status === "unsubscribed") {
        stats.unsubscribed += 1;
      } else if (item.status === "rate_limited") {
        stats.rateLimited += 1;
      }
    }

    return stats;
  }

  private async enqueue(
    templateType: EmailTemplateType,
    recipient: EmailRecipient,
    payload: EmailAlertPayload | EmailDigestPayload,
    context: EmailTemplateContext
  ): Promise<string> {
    const email = this.normalizeEmail(recipient.email);
    const id = this.generateId();
    const now = new Date();
    const item: EmailQueueItem = {
      id,
      templateType,
      recipient: { ...recipient, email },
      payload,
      context: {
        ...context,
        recipientName: recipient.name ?? context.recipientName,
      },
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (this.isUnsubscribed(email)) {
      item.status = "unsubscribed";
      this.tracking.set(item.id, item);
      logger.info({ messageId: item.id, email }, "Skipped unsubscribed email");
      return item.id;
    }

    if (this.isBounced(email)) {
      item.status = "bounced";
      this.tracking.set(item.id, item);
      logger.warn({ messageId: item.id, email }, "Skipped bounced email");
      return item.id;
    }

    this.queue.push(item);
    this.tracking.set(item.id, item);

    logger.info(
      { messageId: item.id, templateType, recipient: email },
      "Email queued"
    );

    await this.processQueue();
    return item.id;
  }

  private async processQueueItem(item: EmailQueueItem): Promise<void> {
    if (!this.canSendNow()) {
      item.status = "rate_limited";
      item.updatedAt = new Date();
      this.tracking.set(item.id, item);
      this.queue.push(item);
      return;
    }

    item.status = "processing";
    item.updatedAt = new Date();
    item.attempts += 1;
    this.tracking.set(item.id, item);

    try {
      const template = this.renderTemplate(item);
      const transporter = this.getTransporter();

      if (!transporter) {
        throw new Error("SMTP provider is not configured");
      }

      await transporter.sendMail({
        from: `"${config.SMTP_FROM_NAME}" <${config.SMTP_FROM_ADDRESS}>`,
        to: item.recipient.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      this.recordDeliveryTimestamp();
      item.status = "sent";
      item.deliveredAt = new Date();
      item.updatedAt = new Date();
      this.tracking.set(item.id, item);

      logger.info(
        { messageId: item.id, templateType: item.templateType },
        "Email delivered"
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      item.lastError = errorMessage;
      item.updatedAt = new Date();

      if (item.attempts < this.maxAttempts) {
        item.status = "queued";
        this.queue.push(item);
      } else {
        item.status = "failed";
      }

      this.tracking.set(item.id, item);
      logger.error(
        { error, messageId: item.id, attempts: item.attempts },
        "Email delivery failed"
      );
    }
  }

  private renderTemplate(item: EmailQueueItem): EmailTemplate {
    const renderer = this.templates.get(item.templateType);
    if (!renderer) {
      throw new Error(`Template not registered: ${item.templateType}`);
    }

    const unsubscribeUrl = `/unsubscribe?email=${encodeURIComponent(
      item.recipient.email
    )}`;

    return renderer(item.payload, {
      ...(item.context ?? {}),
      unsubscribeUrl,
    });
  }

  private getTransporter(): Transporter | null {
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) {
      logger.warn("SMTP not configured - email sending disabled");
      return null;
    }

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: {
          user: config.SMTP_USER,
          pass: config.SMTP_PASSWORD,
        },
      });
    }

    return this.transporter;
  }

  private canSendNow(): boolean {
    const now = Date.now();
    const cutoff = now - this.rateLimit.windowMs;
    while (
      this.recentDeliveryTimestamps.length > 0 &&
      this.recentDeliveryTimestamps[0] < cutoff
    ) {
      this.recentDeliveryTimestamps.shift();
    }

    return this.recentDeliveryTimestamps.length < this.rateLimit.maxPerMinute;
  }

  private recordDeliveryTimestamp(): void {
    this.recentDeliveryTimestamps.push(Date.now());
  }

  private registerDefaultTemplates(): void {
    this.registerTemplate<EmailAlertPayload>("alert", (payload, context) => {
      const headline = `[${payload.severity.toUpperCase()}] ${payload.alertType} - ${payload.assetCode}`;
      const metadataLines = payload.metadata
        ? Object.entries(payload.metadata)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join("\n")
        : "No additional metadata";

      const html = `
<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2>${headline}</h2>
    <p>Hello ${context.recipientName ?? "Subscriber"},</p>
    <p>${payload.message}</p>
    <p><strong>Triggered at:</strong> ${payload.triggeredAt}</p>
    <pre>${metadataLines}</pre>
    <p><a href="${context.unsubscribeUrl ?? "#"}">Unsubscribe</a></p>
  </body>
</html>`;

      const text = [
        headline,
        "",
        `Hello ${context.recipientName ?? "Subscriber"},`,
        payload.message,
        "",
        `Triggered at: ${payload.triggeredAt}`,
        "",
        metadataLines,
        "",
        `Unsubscribe: ${context.unsubscribeUrl ?? "N/A"}`,
      ].join("\n");

      return {
        subject: headline,
        html,
        text,
      };
    });

    this.registerTemplate<EmailDigestPayload>("digest", (payload, context) => {
      const subject = `Bridge Watch Digest - ${payload.periodLabel}`;
      const itemsHtml = payload.items
        .map(
          (item) => `
      <li>
        <strong>${item.title}</strong><br />
        ${item.summary}<br />
        <small>${item.timestamp}</small>
      </li>`
        )
        .join("");

      const itemsText = payload.items
        .map(
          (item) =>
            `- ${item.title}\n  ${item.summary}\n  ${item.timestamp}`
        )
        .join("\n");

      const html = `
<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.5;">
    <h2>${subject}</h2>
    <p>Hello ${context.recipientName ?? "Subscriber"},</p>
    <p>Digest generated at ${payload.generatedAt}.</p>
    <ul>${itemsHtml}</ul>
    <p><a href="${context.unsubscribeUrl ?? "#"}">Unsubscribe</a></p>
  </body>
</html>`;

      const text = [
        subject,
        "",
        `Hello ${context.recipientName ?? "Subscriber"},`,
        `Digest generated at ${payload.generatedAt}.`,
        "",
        itemsText || "No digest items.",
        "",
        `Unsubscribe: ${context.unsubscribeUrl ?? "N/A"}`,
      ].join("\n");

      return {
        subject,
        html,
        text,
      };
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private generateId(): string {
    return `email_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export const emailNotificationService = new EmailNotificationService();
