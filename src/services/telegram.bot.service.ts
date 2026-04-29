import { Telegraf, Context, Markup } from "telegraf";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getDatabase } from "../database/connection.js";
import Redis from "ioredis";
import { formatAlertMessage, escapeTelegramMarkdown } from "./formatters/telegram.formatter.js";

export interface AlertEvent {
  id: string;
  ruleId: string;
  assetCode: string;
  alertType: string;
  priority: "critical" | "high" | "medium" | "low";
  triggeredValue: string | number;
  threshold: string | number;
  metric: string;
  time: Date;
}

export interface TelegramSubscription {
  id: string;
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel";
  telegramUserId?: string;
  severities: string[];
  areas: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class TelegramBotService {
  private bot: Telegraf<Context>;
  private db = getDatabase();
  private redis: Redis;
  private isRunningFlag = false;
  private chatRateLimiters: Map<string, RateLimitEntry> = new Map();
  private alertSubscriptions: Map<string, TelegramSubscription> = new Map();
  private deliveryPaused = false;

  constructor(redisClient?: Redis) {
    this.redis = redisClient || new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD || undefined,
    });

    this.bot = new Telegraf(config.TELEGRAM_BOT_TOKEN || "");
    this.setupMiddleware();
    this.registerCommandHandlers();
  }

  /**
   * Start the Telegram bot service
   */
  async start(): Promise<void> {
    if (!config.TELEGRAM_BOT_TOKEN) {
      logger.warn("TELEGRAM_BOT_TOKEN not configured, Telegram bot disabled");
      return;
    }

    if (!config.TELEGRAM_BOT_ENABLED) {
      logger.warn("Telegram bot is disabled via TELEGRAM_BOT_ENABLED=false");
      return;
    }

    try {
      // Validate token before initializing
      const me = await this.bot.telegram.getMe();
      logger.info(
        { botUsername: me.username, botId: me.id },
        "Telegram bot token validated"
      );

      // Register or set up webhook
      if (config.TELEGRAM_WEBHOOK_URL) {
        await this.setupWebhook();
      } else if (
        !config.NODE_ENV ||
        config.NODE_ENV === "development"
      ) {
        // Development: use polling
        await this.bot.launch({ polling: { timeout: 25, limit: 100 } });
        logger.info("Telegram bot started in polling mode (development)");
      } else {
        throw new Error(
          "TELEGRAM_WEBHOOK_URL is required for production. " +
            "Set it in .env or leave empty + set NODE_ENV=development for polling mode"
        );
      }

      this.isRunningFlag = true;

      // Load subscriptions from database into memory
      await this.loadSubscriptionsIntoMemory();

      // Subscribe to alert events from Redis
      this.subscribeToAlertEvents();

      logger.info("Telegram bot service started successfully");
    } catch (error) {
      logger.error(error, "Failed to start Telegram bot");
      throw error;
    }
  }

  /**
   * Stop the Telegram bot service
   */
  async stop(): Promise<void> {
    if (!this.isRunningFlag) return;

    try {
      // Clean disconnect from webhook
      if (config.TELEGRAM_WEBHOOK_URL) {
        try {
          await this.bot.telegram.deleteWebhook({ drop_pending_updates: false });
          logger.info("Telegram webhook unregistered");
        } catch (error) {
          logger.warn(error, "Failed to unregister webhook on shutdown");
        }
      }

      // Stop polling if active
      await this.bot.stop();

      // Disconnect Redis
      if (this.redis) {
        await this.redis.quit();
      }

      this.isRunningFlag = false;
      logger.info("Telegram bot service stopped");
    } catch (error) {
      logger.error(error, "Error stopping Telegram bot");
    }
  }

  /**
   * Check if bot is running
   */
  isRunning(): boolean {
    return this.isRunningFlag;
  }

  /**
   * Setup webhook for Telegram updates
   */
  private async setupWebhook(): Promise<void> {
    if (!config.TELEGRAM_WEBHOOK_URL || !config.TELEGRAM_WEBHOOK_SECRET) {
      throw new Error(
        "TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET must be set for webhook mode"
      );
    }

    try {
      await this.bot.telegram.setWebhook(config.TELEGRAM_WEBHOOK_URL, {
        secret_token: config.TELEGRAM_WEBHOOK_SECRET,
        max_connections: 40,
        allowed_updates: ["message", "callback_query"],
      });

      const webhookInfo = await this.bot.telegram.getWebhookInfo();
      logger.info(
        {
          url: webhookInfo.url,
          pendingUpdateCount: webhookInfo.pending_update_count,
        },
        "Telegram webhook registered"
      );
    } catch (error) {
      logger.error(error, "Failed to setup Telegram webhook");
      throw error;
    }
  }

  /**
   * Get webhook handler for Express/Fastify integration
   * Usage: app.post('/api/v1/telegram/webhook', telegramService.getWebhookHandler())
   */
  getWebhookHandler() {
    return this.bot.webhookCallback("/api/v1/telegram/webhook");
  }

  /**
   * Setup middleware for all updates
   */
  private setupMiddleware(): void {
    // Rate limiting middleware for commands
    this.bot.use((ctx, next) => {
      if (ctx.message && ctx.message.text?.startsWith("/")) {
        const chatId = ctx.chat?.id.toString() || "unknown";
        if (!this.checkRateLimit(chatId)) {
          ctx.reply(
            "⏱️ Too many commands. Please wait before sending another command."
          );
          return;
        }
      }
      return next();
    });

    // Logging middleware
    this.bot.use((ctx, next) => {
      const chatId = ctx.chat?.id;
      const messageType = ctx.message?.type || ctx.callback_query ? "callback" : "unknown";

      logger.debug(
        {
          chatId,
          messageType,
          userId: ctx.from?.id,
        },
        "Telegram update received"
      );

      return next();
    });
  }

  /**
   * Register command handlers
   */
  private registerCommandHandlers(): void {
    // /start command
    this.bot.command("start", async (ctx) => {
      try {
        const chatId = ctx.chat.id.toString();
        const userId = ctx.from?.id;

        await this.subscribeChat(chatId, ctx.chat.type, userId?.toString());

        await ctx.replyWithMarkdown(
          `*Welcome to Bridge Watch Bot!* 🌉\n\n` +
            `I'll send you real-time alerts about bridge health, prices, and system status.\n\n` +
            `Available commands:\n` +
            `• /help - Show help message\n` +
            `• /status - View current system status\n` +
            `• /subscribe - Manage alert subscriptions\n` +
            `• /subscriptions - View your active subscriptions\n` +
            `• /alerts - View recent alerts\n\n` +
            `Need assistance? Contact support@bridge-watch.io`
        );

        logger.info({ chatId, userId }, "User started bot");
      } catch (error) {
        logger.error(error, "Error in /start command");
        ctx.reply("❌ An error occurred. Please try again later.");
      }
    });

    // /help command
    this.bot.command("help", (ctx) => {
      ctx.replyWithMarkdown(
        `*Bridge Watch Bot Commands* ℹ️\n\n` +
          `*Subscription Management:*\n` +
          `• /subscribe - Configure alert subscriptions\n` +
          `• /unsubscribe - Stop receiving alerts\n` +
          `• /subscriptions - View current subscriptions\n\n` +
          `*Information:*\n` +
          `• /status - System status and metrics\n` +
          `• /alerts - Recent alert history (last 10)\n\n` +
          `*Admin Commands:*\n` +
          `• /broadcast - Send message to all subscribers (admin)\n` +
          `• /pause - Pause alert delivery (admin)\n` +
          `• /resume - Resume alert delivery (admin)\n\n` +
          `For more info, visit: https://bridge-watch.io/docs`
      );
    });

    // /status command
    this.bot.command("status", async (ctx) => {
      try {
        const status = await this.getSystemStatus();
        await ctx.replyWithMarkdown(status);
      } catch (error) {
        logger.error(error, "Error in /status command");
        ctx.reply("❌ Failed to fetch status. Please try again.");
      }
    });

    // /subscribe command
    this.bot.command("subscribe", async (ctx) => {
      try {
        const chatId = ctx.chat.id.toString();
        const subscription = await this.getSubscription(chatId);

        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback(
              subscription?.severities.includes("critical")
                ? "✓ Critical"
                : "• Critical",
              "sev:critical"
            ),
            Markup.button.callback(
              subscription?.severities.includes("high") ? "✓ High" : "• High",
              "sev:high"
            ),
          ],
          [
            Markup.button.callback(
              subscription?.severities.includes("medium") ? "✓ Medium" : "• Medium",
              "sev:medium"
            ),
            Markup.button.callback(
              subscription?.severities.includes("low") ? "✓ Low" : "• Low",
              "sev:low"
            ),
          ],
          [Markup.button.callback("✅ Save", "sev:save")],
        ]);

        await ctx.replyWithMarkdown(
          `*Select alert severity levels to receive:*\n\n` +
            `🔴 *Critical* - System-critical incidents\n` +
            `🟠 *High* - Major disruptions\n` +
            `🟡 *Medium* - Important issues\n` +
            `🟢 *Low* - Minor notifications`,
          keyboard
        );
      } catch (error) {
        logger.error(error, "Error in /subscribe command");
        ctx.reply("❌ Failed to access subscriptions. Please try again.");
      }
    });

    // /subscriptions command
    this.bot.command("subscriptions", async (ctx) => {
      try {
        const chatId = ctx.chat.id.toString();
        const subscription = await this.getSubscription(chatId);

        if (!subscription || !subscription.isActive) {
          await ctx.replyWithMarkdown(
            `*No active subscriptions*\n\n` +
              `Use /subscribe to start receiving alerts.`
          );
          return;
        }

        const severities = subscription.severities.join(", ") || "None";
        await ctx.replyWithMarkdown(
          `*Your Alert Subscriptions* 📋\n\n` +
            `*Severity Levels:* ${severities}\n` +
            `*Status:* ${subscription.isActive ? "✅ Active" : "⛔ Inactive"}\n` +
            `*Subscribed:* ${subscription.createdAt.toLocaleDateString()}\n\n` +
            `Use /subscribe to modify settings.`
        );
      } catch (error) {
        logger.error(error, "Error in /subscriptions command");
        ctx.reply("❌ Failed to fetch subscriptions. Please try again.");
      }
    });

    // /alerts command
    this.bot.command("alerts", async (ctx) => {
      try {
        const chatId = ctx.chat.id.toString();
        const alerts = await this.getRecentAlerts(10);

        if (alerts.length === 0) {
          await ctx.replyWithMarkdown(`*No recent alerts* ✅`);
          return;
        }

        let message = `*Recent Alerts (Last 10)* 🚨\n\n`;
        alerts.forEach((alert, index) => {
          message += `${index + 1}. [${alert.priority.toUpperCase()}] ${alert.metric}\n`;
          message += `   Asset: ${escapeTelegramMarkdown(alert.assetCode)}\n`;
          message += `   Time: ${new Date(alert.time).toLocaleString()}\n\n`;
        });

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        logger.error(error, "Error in /alerts command");
        ctx.reply("❌ Failed to fetch alerts. Please try again.");
      }
    });

    // Callback query handlers
    this.bot.action(/^sev:/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const action = ctx.match[0].split(":")[1];

        if (action === "save") {
          await ctx.reply("✅ Subscription preferences saved!");
          return;
        }

        const chatId = ctx.chat!.id.toString();
        const subscription = await this.getSubscription(chatId);

        if (!subscription) {
          await ctx.reply("❌ Subscription not found.");
          return;
        }

        // Toggle severity
        if (subscription.severities.includes(action)) {
          subscription.severities = subscription.severities.filter(s => s !== action);
        } else {
          subscription.severities.push(action);
        }

        await this.updateSubscription(chatId, subscription);
        await ctx.reply(`✓ Subscription updated`);
      } catch (error) {
        logger.error(error, "Error in callback query");
        ctx.answerCbQuery("An error occurred", true);
      }
    });

    // Admin commands
    this.bot.command("broadcast", async (ctx) => {
      try {
        if (!(await this.isAdminChat(ctx.chat.id.toString(), ctx.from?.id?.toString()))) {
          ctx.reply("❌ Unauthorized");
          return;
        }

        const message = ctx.message?.text?.replace("/broadcast ", "") || "";
        if (!message) {
          ctx.reply("❌ Provide a message to broadcast");
          return;
        }

        const broadcasted = await this.broadcastMessage(message);
        ctx.reply(`✅ Message sent to ${broadcasted} chats`);

        logger.info(
          { count: broadcasted, userId: ctx.from?.id },
          "Broadcast message sent"
        );
      } catch (error) {
        logger.error(error, "Error in /broadcast command");
        ctx.reply("❌ Broadcast failed");
      }
    });

    this.bot.command("pause", async (ctx) => {
      try {
        if (!(await this.isAdminChat(ctx.chat.id.toString(), ctx.from?.id?.toString()))) {
          ctx.reply("❌ Unauthorized");
          return;
        }

        await this.pauseDelivery();
        ctx.reply("⏸️ Alert delivery paused");
        logger.info({ userId: ctx.from?.id }, "Alert delivery paused by admin");
      } catch (error) {
        logger.error(error, "Error in /pause command");
        ctx.reply("❌ Failed to pause delivery");
      }
    });

    this.bot.command("resume", async (ctx) => {
      try {
        if (!(await this.isAdminChat(ctx.chat.id.toString(), ctx.from?.id?.toString()))) {
          ctx.reply("❌ Unauthorized");
          return;
        }

        await this.resumeDelivery();
        ctx.reply("▶️ Alert delivery resumed");
        logger.info({ userId: ctx.from?.id }, "Alert delivery resumed by admin");
      } catch (error) {
        logger.error(error, "Error in /resume command");
        ctx.reply("❌ Failed to resume delivery");
      }
    });
  }

  /**
   * Deliver alert to subscribed chats
   */
  async deliverAlert(alert: AlertEvent): Promise<void> {
    if (this.deliveryPaused) {
      logger.debug({ alertId: alert.id }, "Alert delivery paused, skipping");
      return;
    }

    const subscribers = await this.getSubscribersForAlert(alert.priority);

    for (const subscriber of subscribers) {
      try {
        const message = formatAlertMessage(alert);
        await this.sendMessageWithRateLimit(subscriber.chatId, message);

        logger.debug(
          { alertId: alert.id, chatId: subscriber.chatId },
          "Alert delivered to subscriber"
        );
      } catch (error) {
        logger.error(
          { error, alertId: alert.id, chatId: subscriber.chatId },
          "Failed to deliver alert to subscriber"
        );
      }
    }
  }

  /**
   * Send message with rate limiting
   */
  private async sendMessageWithRateLimit(
    chatId: string,
    message: string
  ): Promise<void> {
    const globalKey = "telegram:outbound:global";
    const chatKey = `telegram:outbound:chat:${chatId}`;

    // Global rate limiting
    const globalCount = await this.redis.incr(globalKey);
    if (globalCount === 1) {
      await this.redis.expire(
        globalKey,
        Math.ceil(1 / config.TELEGRAM_RATE_LIMIT_OUTBOUND_GLOBAL_PER_SEC)
      );
    }

    if (
      globalCount >
      config.TELEGRAM_RATE_LIMIT_OUTBOUND_GLOBAL_PER_SEC
    ) {
      logger.warn("Global Telegram rate limit exceeded");
      throw new Error("Global rate limit exceeded");
    }

    // Per-chat rate limiting
    const chatCount = await this.redis.incr(chatKey);
    if (chatCount === 1) {
      await this.redis.expire(
        chatKey,
        Math.ceil(1 / config.TELEGRAM_RATE_LIMIT_OUTBOUND_PER_CHAT_PER_SEC)
      );
    }

    if (
      chatCount >
      config.TELEGRAM_RATE_LIMIT_OUTBOUND_PER_CHAT_PER_SEC
    ) {
      logger.warn({ chatId }, "Per-chat Telegram rate limit exceeded");
      throw new Error("Per-chat rate limit exceeded");
    }

    await this.bot.telegram.sendMessage(chatId, message, {
      parse_mode: "MarkdownV2",
    });
  }

  /**
   * Check inbound command rate limit
   */
  private checkRateLimit(chatId: string): boolean {
    const now = Date.now();
    const entry = this.chatRateLimiters.get(chatId);

    if (!entry || now > entry.resetTime) {
      this.chatRateLimiters.set(chatId, {
        count: 1,
        resetTime:
          now +
          config.TELEGRAM_RATE_LIMIT_INBOUND_WINDOW_SEC * 1000,
      });
      return true;
    }

    if (entry.count < config.TELEGRAM_RATE_LIMIT_INBOUND_COMMANDS_PER_WINDOW) {
      entry.count++;
      return true;
    }

    return false;
  }

  /**
   * Subscribe a chat to alerts
   */
  private async subscribeChat(
    chatId: string,
    chatType: string,
    userId?: string
  ): Promise<void> {
    const subscription: TelegramSubscription = {
      id: chatId,
      chatId,
      chatType: chatType as "private" | "group" | "supergroup" | "channel",
      telegramUserId: userId,
      severities: ["critical", "high"],
      areas: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const existing = await this.db("telegram_subscriptions")
      .where("chat_id", chatId)
      .first();

    if (existing) {
      await this.db("telegram_subscriptions")
        .where("chat_id", chatId)
        .update({
          is_active: true,
          updated_at: new Date(),
        });
    } else {
      await this.db("telegram_subscriptions").insert({
        id: subscription.id,
        chat_id: chatId,
        chat_type: chatType,
        telegram_user_id: userId,
        severities: JSON.stringify(subscription.severities),
        areas: JSON.stringify(subscription.areas),
        is_active: true,
        created_at: subscription.createdAt,
        updated_at: subscription.updatedAt,
      });
    }

    this.alertSubscriptions.set(chatId, subscription);
  }

  /**
   * Get subscription for a chat
   */
  private async getSubscription(chatId: string): Promise<TelegramSubscription | null> {
    const cached = this.alertSubscriptions.get(chatId);
    if (cached) return cached;

    const row = await this.db("telegram_subscriptions")
      .where("chat_id", chatId)
      .first();

    if (!row) return null;

    const subscription: TelegramSubscription = {
      id: row.id,
      chatId: row.chat_id,
      chatType: row.chat_type,
      telegramUserId: row.telegram_user_id,
      severities: JSON.parse(row.severities || "[]"),
      areas: JSON.parse(row.areas || "[]"),
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    this.alertSubscriptions.set(chatId, subscription);
    return subscription;
  }

  /**
   * Update subscription
   */
  async updateSubscription(
    chatId: string,
    updates: Partial<TelegramSubscription>
  ): Promise<void> {
    await this.db("telegram_subscriptions")
      .where("chat_id", chatId)
      .update({
        ...(updates.severities && {
          severities: JSON.stringify(updates.severities),
        }),
        ...(updates.areas && { areas: JSON.stringify(updates.areas) }),
        ...(updates.isActive !== undefined && {
          is_active: updates.isActive,
        }),
        updated_at: new Date(),
      });

    const current = this.alertSubscriptions.get(chatId);
    if (current) {
      this.alertSubscriptions.set(chatId, { ...current, ...updates });
    }
  }

  /**
   * Get subscribers for an alert at a given priority
   */
  private async getSubscribersForAlert(
    priority: string
  ): Promise<TelegramSubscription[]> {
    const rows = await this.db("telegram_subscriptions")
      .where("is_active", true)
      .whereRaw(
        "? = ANY(severities) OR ? = ANY(severities) OR ? = ANY(severities) OR ? = ANY(severities)",
        [priority, "critical", "high", "medium"]
      );

    return rows.map((row: any) => ({
      id: row.id,
      chatId: row.chat_id,
      chatType: row.chat_type,
      telegramUserId: row.telegram_user_id,
      severities: JSON.parse(row.severities || "[]"),
      areas: JSON.parse(row.areas || "[]"),
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get system status message
   */
  private async getSystemStatus(): Promise<string> {
    const alertCount = await this.db("alert_events")
      .count("* as count")
      .where("created_at", ">", new Date(Date.now() - 24 * 60 * 60 * 1000))
      .first();

    return (
      `📊 *System Status*\n\n` +
      `Health: 🟢 Good\n` +
      `Active Alerts (24h): ${alertCount?.count || 0}\n` +
      `Subscribers: ${this.alertSubscriptions.size}\n` +
      `Last Check: ${new Date().toLocaleTimeString()}\n\n` +
      `[Dashboard](https://bridge-watch.io/dashboard)`
    );
  }

  /**
   * Get recent alerts
   */
  private async getRecentAlerts(limit: number = 10): Promise<AlertEvent[]> {
    const rows = await this.db("alert_events")
      .orderBy("created_at", "desc")
      .limit(limit);

    return rows.map((row: any) => ({
      id: row.id,
      ruleId: row.rule_id,
      assetCode: row.asset_code,
      alertType: row.alert_type,
      priority: row.priority,
      triggeredValue: row.triggered_value,
      threshold: row.threshold,
      metric: row.metric,
      time: row.created_at,
    }));
  }

  /**
   * Check if chat is admin
   */
  private async isAdminChat(chatId: string, userId?: string): Promise<boolean> {
    // Check bootstrap admin list
    const bootstrapIds = (config.TELEGRAM_ADMIN_CHAT_IDS || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (bootstrapIds.includes(chatId)) {
      logger.debug({ chatId }, "Admin access granted via bootstrap list");
      return true;
    }

    // TODO: Check application role system here when available
    return false;
  }

  /**
   * Broadcast message to all subscribers
   */
  private async broadcastMessage(message: string): Promise<number> {
    const subscribers = await this.db("telegram_subscriptions")
      .where("is_active", true);

    let successCount = 0;

    for (const subscriber of subscribers) {
      try {
        await this.sendMessageWithRateLimit(
          subscriber.chat_id,
          message
        );
        successCount++;
      } catch (error) {
        logger.error(
          { error, chatId: subscriber.chat_id },
          "Broadcast message failed"
        );
      }
    }

    return successCount;
  }

  /**
   * Pause alert delivery
   */
  async pauseDelivery(): Promise<void> {
    this.deliveryPaused = true;
    logger.info("Alert delivery paused");
  }

  /**
   * Resume alert delivery
   */
  async resumeDelivery(): Promise<void> {
    this.deliveryPaused = false;
    logger.info("Alert delivery resumed");
  }

  /**
   * Load subscriptions into memory from database
   */
  private async loadSubscriptionsIntoMemory(): Promise<void> {
    const rows = await this.db("telegram_subscriptions").where("is_active", true);

    for (const row of rows) {
      const subscription: TelegramSubscription = {
        id: row.id,
        chatId: row.chat_id,
        chatType: row.chat_type,
        telegramUserId: row.telegram_user_id,
        severities: JSON.parse(row.severities || "[]"),
        areas: JSON.parse(row.areas || "[]"),
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      this.alertSubscriptions.set(row.chat_id, subscription);
    }

    logger.info(
      { count: this.alertSubscriptions.size },
      "Subscriptions loaded into memory"
    );
  }

  /**
   * Subscribe to alert events from Redis
   */
  private subscribeToAlertEvents(): void {
    const alertChannel = this.redis.createClient();

    alertChannel.subscribe("bw:alerts:created", (err) => {
      if (err) {
        logger.error(err, "Failed to subscribe to alert events");
      }
    });

    alertChannel.on("message", async (channel, message) => {
      try {
        const alert = JSON.parse(message) as AlertEvent;
        await this.deliverAlert(alert);
      } catch (error) {
        logger.error(error, "Error processing alert event from Redis");
      }
    });
  }
}

// Singleton instance
let instance: TelegramBotService | null = null;

export function getTelegramBotService(): TelegramBotService {
  if (!instance) {
    instance = new TelegramBotService();
  }
  return instance;
}
