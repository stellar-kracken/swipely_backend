import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DiscordService } from "../../services/discord.service.js";
import { getDatabase } from "../../database/connection.js";
import { logger } from "../../utils/logger.js";

const discordService = new DiscordService();

export async function discordRoutes(server: FastifyInstance) {
  // Get Discord subscriptions
  server.get(
    "/subscriptions",
    async (
      request: FastifyRequest<{
        Querystring: { guildId?: string; active?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { guildId, active } = request.query;
        const db = getDatabase();

        let query = db("discord_subscriptions");
        
        if (guildId) {
          query = query.where("guild_id", guildId);
        }
        
        if (active !== undefined) {
          query = query.where("is_active", active === "true");
        }

        const subscriptions = await query.orderBy("created_at", "desc");

        return { success: true, data: subscriptions };
      } catch (error) {
        logger.error(error, "Failed to get Discord subscriptions");
        reply.code(500);
        return { success: false, error: "Failed to get Discord subscriptions" };
      }
    }
  );

  // Create Discord subscription
  server.post(
    "/subscriptions",
    async (
      request: FastifyRequest<{
        Body: {
          guildId: string;
          channelId: string;
          alertTypes: string[];
          assets?: string[];
          bridges?: string[];
          minSeverity?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const {
          guildId,
          channelId,
          alertTypes,
          assets = [],
          bridges = [],
          minSeverity = "low",
        } = request.body;

        const subscription = await discordService.subscribeToAlerts(
          guildId,
          channelId,
          alertTypes,
          assets,
          bridges,
          minSeverity
        );

        return { success: true, data: subscription };
      } catch (error) {
        logger.error(error, "Failed to create Discord subscription");
        reply.code(500);
        return { success: false, error: "Failed to create Discord subscription" };
      }
    }
  );

  // Update Discord subscription
  server.put(
    "/subscriptions/:subscriptionId",
    async (
      request: FastifyRequest<{
        Params: { subscriptionId: string };
        Body: {
          alertTypes?: string[];
          assets?: string[];
          bridges?: string[];
          minSeverity?: string;
          isActive?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { subscriptionId } = request.params;
        const updates = request.body;

        const db = getDatabase();
        const [subscription] = await db("discord_subscriptions")
          .where("id", subscriptionId)
          .update({
            ...updates,
            alert_types: updates.alertTypes 
              ? JSON.stringify(updates.alertTypes) 
              : undefined,
            assets: updates.assets 
              ? JSON.stringify(updates.assets) 
              : undefined,
            bridges: updates.bridges 
              ? JSON.stringify(updates.bridges) 
              : undefined,
            updated_at: new Date(),
          })
          .returning("*");

        if (!subscription) {
          reply.code(404);
          return { success: false, error: "Subscription not found" };
        }

        return { success: true, data: subscription };
      } catch (error) {
        logger.error(error, "Failed to update Discord subscription");
        reply.code(500);
        return { success: false, error: "Failed to update Discord subscription" };
      }
    }
  );

  // Delete Discord subscription
  server.delete(
    "/subscriptions/:subscriptionId",
    async (
      request: FastifyRequest<{
        Params: { subscriptionId: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { subscriptionId } = request.params;
        const db = getDatabase();

        const subscription = await db("discord_subscriptions")
          .where("id", subscriptionId)
          .first();

        if (!subscription) {
          reply.code(404);
          return { success: false, error: "Subscription not found" };
        }

        await discordService.unsubscribeFromAlerts(
          subscription.guild_id,
          subscription.channel_id
        );

        return { success: true, message: "Subscription deleted successfully" };
      } catch (error) {
        logger.error(error, "Failed to delete Discord subscription");
        reply.code(500);
        return { success: false, error: "Failed to delete Discord subscription" };
      }
    }
  );

  // Get Discord guild settings
  server.get(
    "/guilds/:guildId/settings",
    async (
      request: FastifyRequest<{
        Params: { guildId: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { guildId } = request.params;
        const db = getDatabase();

        const settings = await db("discord_guild_settings")
          .where("guild_id", guildId)
          .first();

        return { success: true, data: settings };
      } catch (error) {
        logger.error(error, "Failed to get Discord guild settings");
        reply.code(500);
        return { success: false, error: "Failed to get Discord guild settings" };
      }
    }
  );

  // Update Discord guild settings
  server.put(
    "/guilds/:guildId/settings",
    async (
      request: FastifyRequest<{
        Params: { guildId: string };
        Body: {
          guildName?: string;
          adminRoleId?: string;
          alertsEnabled?: boolean;
          defaultAlertChannelId?: string;
          defaultMinSeverity?: string;
          disabledCommands?: string[];
          analyticsEnabled?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { guildId } = request.params;
        const updates = request.body;

        const db = getDatabase();
        const [settings] = await db("discord_guild_settings")
          .where("guild_id", guildId)
          .update({
            ...updates,
            disabled_commands: updates.disabledCommands 
              ? JSON.stringify(updates.disabledCommands) 
              : undefined,
            updated_at: new Date(),
          })
          .returning("*");

        return { success: true, data: settings };
      } catch (error) {
        logger.error(error, "Failed to update Discord guild settings");
        reply.code(500);
        return { success: false, error: "Failed to update Discord guild settings" };
      }
    }
  );

  // Get Discord analytics
  server.get(
    "/analytics",
    async (
      request: FastifyRequest<{
        Querystring: { 
          guildId?: string;
          days?: string;
          type?: "commands" | "alerts";
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { guildId, days, type } = request.query;
        const db = getDatabase();

        const data: { commandStats?: unknown[]; alertStats?: unknown[] } = {};

        if (!type || type === "commands") {
          const commandQuery = db("discord_command_stats");
          if (guildId) {
            commandQuery.where("guild_id", guildId);
          }
          const commandStats = await commandQuery;
          data.commandStats = commandStats;
        }

        if (!type || type === "alerts") {
          const alertQuery = db("discord_alert_stats");
          if (guildId) {
            alertQuery.where("guild_id", guildId);
          }
          const alertStats = await alertQuery;
          data.alertStats = alertStats;
        }

        return { success: true, data };
      } catch (error) {
        logger.error(error, "Failed to get Discord analytics");
        reply.code(500);
        return { success: false, error: "Failed to get Discord analytics" };
      }
    }
  );

  // Get guild overview
  server.get(
    "/guilds/:guildId/overview",
    async (
      request: FastifyRequest<{
        Params: { guildId: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { guildId } = request.params;
        const db = getDatabase();

        const overview = await db("discord_guild_overview")
          .where("guild_id", guildId)
          .first();

        return { success: true, data: overview };
      } catch (error) {
        logger.error(error, "Failed to get Discord guild overview");
        reply.code(500);
        return { success: false, error: "Failed to get Discord guild overview" };
      }
    }
  );

  // Send test alert
  server.post(
    "/test-alert",
    async (
      request: FastifyRequest<{
        Body: {
          guildId: string;
          channelId: string;
          type: "bridge" | "pool" | "price" | "health";
          severity: "low" | "medium" | "high" | "critical";
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { guildId, channelId, type, severity } = request.body;

        const testAlert = {
          id: `test-${Date.now()}`,
          type,
          severity,
          title: `Test ${type} Alert`,
          description: "This is a test alert from Bridge Watch to verify Discord integration.",
          metadata: {
            test: true,
            timestamp: new Date().toISOString(),
            guildId,
            channelId,
          },
          timestamp: new Date(),
        };

        await discordService.sendAlert(testAlert);

        return { success: true, message: "Test alert sent successfully" };
      } catch (error) {
        logger.error(error, "Failed to send test Discord alert");
        reply.code(500);
        return { success: false, error: "Failed to send test Discord alert" };
      }
    }
  );

  // Get alert logs
  server.get(
    "/alerts/logs",
    async (
      request: FastifyRequest<{
        Querystring: {
          guildId?: string;
          channelId?: string;
          alertType?: string;
          severity?: string;
          delivered?: string;
          limit?: string;
          days?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const {
          guildId,
          channelId,
          alertType,
          severity,
          delivered,
          limit,
          days,
        } = request.query;

        const db = getDatabase();
        let query = db("discord_alerts_log");

        if (guildId) {
          query = query.where("guild_id", guildId);
        }

        if (channelId) {
          query = query.where("channel_id", channelId);
        }

        if (alertType) {
          query = query.where("alert_type", alertType);
        }

        if (severity) {
          query = query.where("severity", severity);
        }

        if (delivered !== undefined) {
          query = query.where("delivered", delivered === "true");
        }

        if (days) {
          const daysAgo = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
          query = query.where("time", ">", daysAgo);
        }

        query = query.orderBy("time", "desc");

        if (limit) {
          query = query.limit(parseInt(limit));
        }

        const logs = await query;

        return { success: true, data: logs };
      } catch (error) {
        logger.error(error, "Failed to get Discord alert logs");
        reply.code(500);
        return { success: false, error: "Failed to get Discord alert logs" };
      }
    }
  );

  // Get command usage logs
  server.get(
    "/commands/logs",
    async (
      request: FastifyRequest<{
        Querystring: {
          guildId?: string;
          commandName?: string;
          success?: string;
          limit?: string;
          days?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const {
          guildId,
          commandName,
          success,
          limit,
          days,
        } = request.query;

        const db = getDatabase();
        let query = db("discord_commands_usage");

        if (guildId) {
          query = query.where("guild_id", guildId);
        }

        if (commandName) {
          query = query.where("command_name", commandName);
        }

        if (success !== undefined) {
          query = query.where("success", success === "true");
        }

        if (days) {
          const daysAgo = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
          query = query.where("time", ">", daysAgo);
        }

        query = query.orderBy("time", "desc");

        if (limit) {
          query = query.limit(parseInt(limit));
        }

        const logs = await query;

        return { success: true, data: logs };
      } catch (error) {
        logger.error(error, "Failed to get Discord command logs");
        reply.code(500);
        return { success: false, error: "Failed to get Discord command logs" };
      }
    }
  );

  // Health check for Discord integration
  server.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDatabase();
      
      // Check Discord service status
      const isDiscordReady = discordService["client"]?.isReady() || false;
      
      // Get subscription count
      const subscriptionCount = await db("discord_subscriptions")
        .where("is_active", true)
        .count("* as count")
        .first();

      // Get recent activity
      const recentActivity = await db("discord_commands_usage")
        .where("time", ">", new Date(Date.now() - 60 * 60 * 1000)) // Last hour
        .count("* as count")
        .first();

      return {
        success: true,
        data: {
          status: isDiscordReady ? "healthy" : "unhealthy",
          discordReady: isDiscordReady,
          activeSubscriptions: Number(subscriptionCount?.count) || 0,
          recentActivity: Number(recentActivity?.count) || 0,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error(error, "Discord health check failed");
      reply.code(500);
      return { success: false, error: "Discord health check failed" };
    }
  });
}
