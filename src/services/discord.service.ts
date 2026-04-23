import { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  EmbedBuilder, 
  PermissionFlagsBits,
  REST,
  Routes,
  TextChannel,
  GuildMember,
  ActivityType
} from "discord.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getDatabase } from "../database/connection.js";

export interface DiscordAlert {
  id: string;
  type: "bridge" | "pool" | "price" | "health";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface DiscordSubscription {
  id: string;
  guildId: string;
  channelId: string;
  alertTypes: string[];
  assets: string[];
  bridges: string[];
  minSeverity: string;
  isActive: boolean;
  createdAt: Date;
}

export interface DiscordCommand {
  name: string;
  description: string;
  execute: (interaction: any) => Promise<void>;
}

export class DiscordService {
  private client: Client;
  private db = getDatabase();
  private commands: DiscordCommand[] = [];
  private subscriptions: Map<string, DiscordSubscription> = new Map();

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.setupEventHandlers();
    this.registerCommands();
  }

  /**
   * Start the Discord bot
   */
  async start(): Promise<void> {
    if (!config.DISCORD_BOT_TOKEN) {
      logger.warn("DISCORD_BOT_TOKEN not configured, Discord bot disabled");
      return;
    }

    try {
      await this.client.login(config.DISCORD_BOT_TOKEN);
      logger.info("Discord bot started successfully");
    } catch (error) {
      logger.error(error, "Failed to start Discord bot");
      throw error;
    }
  }

  /**
   * Stop the Discord bot
   */
  async stop(): Promise<void> {
    if (this.client.isReady()) {
      await this.client.destroy();
      logger.info("Discord bot stopped");
    }
  }

  /**
   * Send alert to subscribed channels
   */
  async sendAlert(alert: DiscordAlert): Promise<void> {
    const subscriptions = await this.getActiveSubscriptions(alert.type, alert.severity);
    
    for (const subscription of subscriptions) {
      try {
        const channel = await this.client.channels.fetch(subscription.channelId) as TextChannel;
        if (!channel) continue;

        const embed = this.createAlertEmbed(alert);
        await channel.send({ embeds: [embed] });

        logger.info({
          alertId: alert.id,
          channelId: subscription.channelId,
          guildId: subscription.guildId,
        }, "Alert sent to Discord channel");
      } catch (error) {
        logger.error({
          error,
          subscriptionId: subscription.id,
          alertId: alert.id,
        }, "Failed to send alert to Discord channel");
      }
    }
  }

  /**
   * Subscribe a channel to alerts
   */
  async subscribeToAlerts(
    guildId: string,
    channelId: string,
    alertTypes: string[],
    assets: string[] = [],
    bridges: string[] = [],
    minSeverity = "low"
  ): Promise<DiscordSubscription> {
    const subscription: DiscordSubscription = {
      id: `${guildId}-${channelId}`,
      guildId,
      channelId,
      alertTypes,
      assets,
      bridges,
      minSeverity,
      isActive: true,
      createdAt: new Date(),
    };

    await this.db("discord_subscriptions").insert({
      id: subscription.id,
      guild_id: guildId,
      channel_id: channelId,
      alert_types: JSON.stringify(alertTypes),
      assets: JSON.stringify(assets),
      bridges: JSON.stringify(bridges),
      min_severity: minSeverity,
      is_active: true,
      created_at: subscription.createdAt,
    });

    this.subscriptions.set(subscription.id, subscription);
    
    logger.info({
      subscriptionId: subscription.id,
      guildId,
      channelId,
      alertTypes,
    }, "Discord subscription created");

    return subscription;
  }

  /**
   * Unsubscribe a channel from alerts
   */
  async unsubscribeFromAlerts(guildId: string, channelId: string): Promise<void> {
    const subscriptionId = `${guildId}-${channelId}`;
    
    await this.db("discord_subscriptions")
      .where("id", subscriptionId)
      .update({ is_active: false });

    this.subscriptions.delete(subscriptionId);
    
    logger.info({
      subscriptionId,
      guildId,
      channelId,
    }, "Discord subscription removed");
  }

  /**
   * Get active subscriptions for an alert type and severity
   */
  private async getActiveSubscriptions(
    alertType: string,
    severity: string
  ): Promise<DiscordSubscription[]> {
    const severityLevels = { low: 0, medium: 1, high: 2, critical: 3 };
    const minSeverityLevel = severityLevels[severity as keyof typeof severityLevels] || 0;

    const subscriptions = await this.db("discord_subscriptions")
      .where("is_active", true)
      .whereRaw("JSON_CONTAINS(alert_types, ?)", [`"${alertType}"`]);

    return subscriptions
      .map(sub => ({
        id: sub.id,
        guildId: sub.guild_id,
        channelId: sub.channel_id,
        alertTypes: JSON.parse(sub.alert_types),
        assets: JSON.parse(sub.assets || "[]"),
        bridges: JSON.parse(sub.bridges || "[]"),
        minSeverity: sub.min_severity,
        isActive: sub.is_active,
        createdAt: sub.created_at,
      }))
      .filter(sub => {
        const subMinLevel = severityLevels[sub.minSeverity as keyof typeof severityLevels] || 0;
        return subMinLevel <= minSeverityLevel;
      });
  }

  /**
   * Create Discord embed for alert
   */
  private createAlertEmbed(alert: DiscordAlert): EmbedBuilder {
    const colors = {
      low: 0x00ff00,    // Green
      medium: 0xffff00,  // Yellow
      high: 0xff9900,    // Orange
      critical: 0xff0000, // Red
    };

    const embed = new EmbedBuilder()
      .setTitle(alert.title)
      .setDescription(alert.description)
      .setColor(colors[alert.severity])
      .setTimestamp(alert.timestamp)
      .setFooter({ text: "Bridge Watch Alert" });

    // Add metadata fields
    Object.entries(alert.metadata).forEach(([key, value]) => {
      embed.addFields({
        name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: String(value),
        inline: true,
      });
    });

    return embed;
  }

  /**
   * Setup Discord event handlers
   */
  private setupEventHandlers(): void {
    this.client.once("ready", () => {
      logger.info(`Discord bot logged in as ${this.client.user?.tag}`);
      this.updatePresence();
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.find(cmd => cmd.name === interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        logger.error({ error, command: interaction.commandName }, "Discord command execution failed");
        
        const errorMessage = "Sorry, there was an error executing this command.";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      }
    });

    this.client.on("error", (error) => {
      logger.error(error, "Discord client error");
    });

    this.client.on("disconnect", () => {
      logger.warn("Discord client disconnected");
    });
  }

  /**
   * Register slash commands
   */
  private registerCommands(): void {
    this.commands = [
      {
        name: "subscribe",
        description: "Subscribe to Bridge Watch alerts",
        execute: this.handleSubscribe.bind(this),
      },
      {
        name: "unsubscribe",
        description: "Unsubscribe from Bridge Watch alerts",
        execute: this.handleUnsubscribe.bind(this),
      },
      {
        name: "status",
        description: "Get Bridge Watch system status",
        execute: this.handleStatus.bind(this),
      },
      {
        name: "asset",
        description: "Get information about a specific asset",
        execute: this.handleAsset.bind(this),
      },
      {
        name: "bridge",
        description: "Get information about a specific bridge",
        execute: this.handleBridge.bind(this),
      },
      {
        name: "pool",
        description: " Get information about a liquidity pool",
        execute: this.handlePool.bind(this),
      },
    ];

    this.deployCommands();
  }

  /**
   * Deploy slash commands to Discord
   */
  private async deployCommands(): Promise<void> {
    if (!config.DISCORD_BOT_TOKEN || !config.DISCORD_CLIENT_ID) {
      logger.warn("Discord credentials not configured, skipping command deployment");
      return;
    }

    const commands = this.commands.map(cmd => {
      const builder = new SlashCommandBuilder()
        .setName(cmd.name)
        .setDescription(cmd.description);

      // Add command-specific options
      if (cmd.name === "subscribe") {
        builder
          .addStringOption(option =>
            option
              .setName("types")
              .setDescription("Alert types to subscribe to")
              .setRequired(true)
              .addChoices(
                { name: "Bridge", value: "bridge" },
                { name: "Pool", value: "pool" },
                { name: "Price", value: "price" },
                { name: "Health", value: "health" }
              )
          )
          .addStringOption(option =>
            option
              .setName("severity")
              .setDescription("Minimum alert severity")
              .setRequired(false)
              .addChoices(
                { name: "Low", value: "low" },
                { name: "Medium", value: "medium" },
                { name: "High", value: "high" },
                { name: "Critical", value: "critical" }
              )
          );
      } else if (cmd.name === "asset") {
        builder
          .addStringOption(option =>
            option
              .setName("symbol")
              .setDescription("Asset symbol (e.g., USDC, XLM)")
              .setRequired(true)
          );
      } else if (cmd.name === "bridge") {
        builder
          .addStringOption(option =>
            option
              .setName("name")
              .setDescription("Bridge name")
              .setRequired(true)
          );
      } else if (cmd.name === "pool") {
        builder
          .addStringOption(option =>
            option
              .setName("pair")
              .setDescription("Asset pair (e.g., USDC/XLM)")
              .setRequired(true)
          );
      }

      return builder.toJSON();
    });

    const rest = new REST({ version: "10" }).setToken(config.DISCORD_BOT_TOKEN);

    try {
      await rest.put(
        Routes.applicationCommands(config.DISCORD_CLIENT_ID),
        { body: commands }
      );

      logger.info(`Deployed ${commands.length} Discord slash commands`);
    } catch (error) {
      logger.error(error, "Failed to deploy Discord commands");
    }
  }

  /**
   * Update bot presence
   */
  private updatePresence(): void {
    if (this.client.user) {
      this.client.user.setActivity("Bridge Watch", { type: ActivityType.Watching });
    }
  }

  /**
   * Handle /subscribe command
   */
  private async handleSubscribe(interaction: any): Promise<void> {
    const types = interaction.options.getString("types");
    const severity = interaction.options.getString("severity") || "low";

    if (!this.hasPermission(interaction.member)) {
      await interaction.reply({
        content: "You need 'Manage Channels' permission to subscribe to alerts.",
        ephemeral: true,
      });
      return;
    }

    try {
      await this.subscribeToAlerts(
        interaction.guildId,
        interaction.channelId,
        [types],
        [],
        [],
        severity
      );

      await interaction.reply({
        content: `✅ Successfully subscribed to ${types} alerts with minimum severity: ${severity}`,
      });
    } catch (error) {
      logger.error(error, "Failed to process subscription");
      await interaction.reply({
        content: "Failed to subscribe to alerts. Please try again later.",
        ephemeral: true,
      });
    }
  }

  /**
   * Handle /unsubscribe command
   */
  private async handleUnsubscribe(interaction: any): Promise<void> {
    if (!this.hasPermission(interaction.member)) {
      await interaction.reply({
        content: "You need 'Manage Channels' permission to unsubscribe from alerts.",
        ephemeral: true,
      });
      return;
    }

    try {
      await this.unsubscribeFromAlerts(interaction.guildId, interaction.channelId);
      await interaction.reply("✅ Successfully unsubscribed from all alerts");
    } catch (error) {
      logger.error(error, "Failed to process unsubscription");
      await interaction.reply({
        content: "Failed to unsubscribe from alerts. Please try again later.",
        ephemeral: true,
      });
    }
  }

  /**
   * Handle /status command
   */
  private async handleStatus(interaction: any): Promise<void> {
    try {
      const db = this.db;
      
      // Get system status
      const assetCount = await db("assets").where("is_active", true).count("* as count").first();
      const bridgeCount = await db("bridges").where("is_active", true).count("* as count").first();
      const poolCount = await db("liquidity_pools").count("* as count").first();

      const embed = new EmbedBuilder()
        .setTitle("Bridge Watch Status")
        .setColor(0x00ff00)
        .addFields(
          { name: "Active Assets", value: String(assetCount?.count || 0), inline: true },
          { name: "Active Bridges", value: String(bridgeCount?.count || 0), inline: true },
          { name: "Liquidity Pools", value: String(poolCount?.count || 0), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Bridge Watch" });

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error(error, "Failed to get status");
      await interaction.reply({
        content: "Failed to retrieve system status. Please try again later.",
        ephemeral: true,
      });
    }
  }

  /**
   * Handle /asset command
   */
  private async handleAsset(interaction: any): Promise<void> {
    const symbol = interaction.options.getString("symbol");

    try {
      const asset = await this.db("assets")
        .where("symbol", symbol.toUpperCase())
        .first();

      if (!asset) {
        await interaction.reply({
          content: `Asset ${symbol} not found.`,
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`${asset.symbol} - ${asset.name}`)
        .setColor(0x0099ff)
        .addFields(
          { name: "Type", value: asset.asset_type, inline: true },
          { name: "Bridge Provider", value: asset.bridge_provider || "Native", inline: true },
          { name: "Source Chain", value: asset.source_chain || "Stellar", inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Bridge Watch" });

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error(error, "Failed to get asset information");
      await interaction.reply({
        content: "Failed to retrieve asset information. Please try again later.",
        ephemeral: true,
      });
    }
  }

  /**
   * Handle /bridge command
   */
  private async handleBridge(interaction: any): Promise<void> {
    const name = interaction.options.getString("name");

    try {
      const bridge = await this.db("bridges")
        .where("name", "ILIKE", `%${name}%`)
        .first();

      if (!bridge) {
        await interaction.reply({
          content: `Bridge ${name} not found.`,
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(bridge.name)
        .setColor(0x0099ff)
        .addFields(
          { name: "Source Chain", value: bridge.source_chain, inline: true },
          { name: "Status", value: bridge.status, inline: true },
          { name: "TVL", value: `$${Number(bridge.total_value_locked).toLocaleString()}`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Bridge Watch" });

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error(error, "Failed to get bridge information");
      await interaction.reply({
        content: "Failed to retrieve bridge information. Please try again later.",
        ephemeral: true,
      });
    }
  }

  /**
   * Handle /pool command
   */
  private async handlePool(interaction: any): Promise<void> {
    const pair = interaction.options.getString("pair");
    const [assetA, assetB] = pair?.split("/") || [];

    if (!assetA || !assetB) {
      await interaction.reply({
        content: "Invalid pair format. Use format: ASSETA/ASSETB (e.g., USDC/XLM)",
        ephemeral: true,
      });
      return;
    }

    try {
      const pool = await this.db("liquidity_pools")
        .where("asset_a", assetA.toUpperCase())
        .where("asset_b", assetB.toUpperCase())
        .first();

      if (!pool) {
        await interaction.reply({
          content: `Pool ${pair} not found.`,
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`${pool.asset_a}/${pool.asset_b} on ${pool.dex}`)
        .setColor(0x0099ff)
        .addFields(
          { name: "DEX", value: pool.dex, inline: true },
          { name: "TVL", value: `$${Number(pool.total_liquidity).toLocaleString()}`, inline: true },
          { name: "APR", value: `${pool.apr}%`, inline: true },
          { name: "Health Score", value: `${pool.health_score}/100`, inline: true },
          { name: "24h Volume", value: `$${Number(pool.volume_24h).toLocaleString()}`, inline: true },
          { name: "Fee", value: `${(pool.fee * 100).toFixed(3)}%`, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "Bridge Watch" });

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      logger.error(error, "Failed to get pool information");
      await interaction.reply({
        content: "Failed to retrieve pool information. Please try again later.",
        ephemeral: true,
      });
    }
  }

  /**
   * Check if user has required permissions
   */
  private hasPermission(member: GuildMember | null): boolean {
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.ManageChannels);
  }
}
