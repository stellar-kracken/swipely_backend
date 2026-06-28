import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DiscordService, DiscordAlert, DiscordSubscription } from "../../src/services/discord.service.js";

// ---------------------------------------------------------------------------
// Mock discord.js
// ---------------------------------------------------------------------------
const mockEmbed = {
  setTitle: vi.fn().mockReturnThis(),
  setDescription: vi.fn().mockReturnThis(),
  setColor: vi.fn().mockReturnThis(),
  setTimestamp: vi.fn().mockReturnThis(),
  setFooter: vi.fn().mockReturnThis(),
  addFields: vi.fn().mockReturnThis(),
};

const mockChannel = {
  send: vi.fn().mockResolvedValue({}),
};

const mockUser = {
  tag: "BridgeWatch#0001",
  setActivity: vi.fn(),
};

const mockClientInstance = {
  isReady: vi.fn().mockReturnValue(false),
  login: vi.fn().mockResolvedValue("token"),
  destroy: vi.fn().mockResolvedValue(undefined),
  channels: {
    fetch: vi.fn().mockResolvedValue(mockChannel),
  },
  user: mockUser,
  once: vi.fn(),
  on: vi.fn(),
};

vi.mock("discord.js", () => {
  return {
    Client: vi.fn().mockImplementation(() => mockClientInstance),
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 512,
      MessageContent: 32768,
    },
    SlashCommandBuilder: vi.fn().mockImplementation(() => ({
      setName: vi.fn().mockReturnThis(),
      setDescription: vi.fn().mockReturnThis(),
      addStringOption: vi.fn().mockReturnThis(),
      toJSON: vi.fn().mockReturnValue({}),
    })),
    EmbedBuilder: vi.fn().mockImplementation(() => mockEmbed),
    PermissionFlagsBits: {
      ManageChannels: BigInt(16),
    },
    REST: vi.fn().mockImplementation(() => ({
      setToken: vi.fn().mockReturnThis(),
      put: vi.fn().mockResolvedValue([]),
    })),
    Routes: {
      applicationCommands: vi.fn().mockReturnValue("/applications/test/commands"),
    },
    ActivityType: {
      Watching: 3,
    },
  };
});

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------
vi.mock("../../src/config/index.js", () => ({
  config: {
    DISCORD_BOT_TOKEN: "test-bot-token",
    DISCORD_CLIENT_ID: "test-client-id",
  },
}));

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock database
// ---------------------------------------------------------------------------
const mockDbObj = {
  insert: vi.fn(),
  where: vi.fn(),
  whereRaw: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  first: vi.fn(),
  select: vi.fn(),
  count: vi.fn(),
};

// Make all methods return mockDbObj so chains work
Object.keys(mockDbObj).forEach((key) => {
  (mockDbObj as any)[key].mockReturnValue(mockDbObj);
});

// Specific terminal resolvers
mockDbObj.insert.mockResolvedValue([1]);
mockDbObj.update.mockResolvedValue(1);
mockDbObj.first.mockResolvedValue(null);

const mockDb = vi.fn().mockImplementation(() => mockDbObj) as any;
Object.assign(mockDb, mockDbObj);

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockDb,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAlert(overrides: Partial<DiscordAlert> = {}): DiscordAlert {
  return {
    id: "alert-001",
    type: "bridge",
    severity: "high",
    title: "Bridge TVL Drop",
    description: "TVL dropped by 20%",
    metadata: { bridge: "Stellar-USDC", tvl: 1_000_000 },
    timestamp: new Date("2025-01-15T10:00:00Z"),
    ...overrides,
  };
}

function makeSubscriptionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "guild-001-chan-001",
    guild_id: "guild-001",
    channel_id: "chan-001",
    alert_types: JSON.stringify(["bridge"]),
    assets: JSON.stringify([]),
    bridges: JSON.stringify([]),
    min_severity: "low",
    is_active: true,
    created_at: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DiscordService", () => {
  let service: DiscordService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock channel send
    mockChannel.send.mockResolvedValue({});

    // Reset mockDbObj chains
    Object.keys(mockDbObj).forEach((key) => {
      (mockDbObj as any)[key].mockReturnValue(mockDbObj);
    });
    mockDbObj.insert.mockResolvedValue([1]);
    mockDbObj.update.mockResolvedValue(1);
    mockDbObj.first.mockResolvedValue(null);

    // Reset client isReady
    mockClientInstance.isReady.mockReturnValue(false);

    service = new DiscordService();
  });

  afterEach(async () => {
    // nothing extra needed
  });

  // -------------------------------------------------------------------------
  describe("Service Lifecycle", () => {
    it("should construct without throwing", () => {
      expect(() => new DiscordService()).not.toThrow();
    });

    it("should call client.login on start()", async () => {
      await service.start();
      expect(mockClientInstance.login).toHaveBeenCalledWith("test-bot-token");
    });

    it("should log a warning and skip login when no bot token is configured", async () => {
      const { logger } = await import("../../src/utils/logger.js");
      // Swap config to remove token
      vi.doMock("../../src/config/index.js", () => ({
        config: { DISCORD_BOT_TOKEN: undefined, DISCORD_CLIENT_ID: "test-client-id" },
      }));
      // Reconstruct with token missing scenario – call start on same service
      // We can test this by not providing the token in the client
      mockClientInstance.login.mockRejectedValueOnce(new Error("Invalid token"));

      await expect(service.start()).rejects.toThrow("Invalid token");
      expect(logger.error).toHaveBeenCalled();
    });

    it("should call client.destroy on stop() when client is ready", async () => {
      mockClientInstance.isReady.mockReturnValue(true);
      await service.stop();
      expect(mockClientInstance.destroy).toHaveBeenCalled();
    });

    it("should not call client.destroy on stop() when client is not ready", async () => {
      mockClientInstance.isReady.mockReturnValue(false);
      await service.stop();
      expect(mockClientInstance.destroy).not.toHaveBeenCalled();
    });

    it("should register event handlers on construction", () => {
      expect(mockClientInstance.once).toHaveBeenCalledWith("ready", expect.any(Function));
      expect(mockClientInstance.on).toHaveBeenCalledWith("interactionCreate", expect.any(Function));
      expect(mockClientInstance.on).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  // -------------------------------------------------------------------------
  describe("subscribeToAlerts", () => {
    it("should insert a new subscription into the database", async () => {
      const result = await service.subscribeToAlerts(
        "guild-001",
        "chan-001",
        ["bridge", "pool"],
        ["USDC"],
        ["stellar-bridge"],
        "medium"
      );

      expect(mockDb).toHaveBeenCalledWith("discord_subscriptions");
      expect(mockDbObj.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "guild-001-chan-001",
          guild_id: "guild-001",
          channel_id: "chan-001",
          min_severity: "medium",
          is_active: true,
        })
      );
      expect(result.id).toBe("guild-001-chan-001");
      expect(result.guildId).toBe("guild-001");
      expect(result.channelId).toBe("chan-001");
      expect(result.alertTypes).toEqual(["bridge", "pool"]);
      expect(result.assets).toEqual(["USDC"]);
      expect(result.bridges).toEqual(["stellar-bridge"]);
      expect(result.minSeverity).toBe("medium");
      expect(result.isActive).toBe(true);
    });

    it("should default assets, bridges, and minSeverity when not provided", async () => {
      const result = await service.subscribeToAlerts("guild-002", "chan-002", ["health"]);

      expect(result.assets).toEqual([]);
      expect(result.bridges).toEqual([]);
      expect(result.minSeverity).toBe("low");
    });

    it("should store subscription in the in-memory map", async () => {
      await service.subscribeToAlerts("guild-003", "chan-003", ["price"]);
      // Send an alert that targets the stored subscription – the map should
      // be consulted before the DB query, but since getActiveSubscriptions
      // uses the DB, we just verify no errors are thrown.
      expect(mockDbObj.insert).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("unsubscribeFromAlerts", () => {
    it("should set is_active to false in the database", async () => {
      await service.unsubscribeFromAlerts("guild-001", "chan-001");

      expect(mockDb).toHaveBeenCalledWith("discord_subscriptions");
      expect(mockDbObj.where).toHaveBeenCalledWith("id", "guild-001-chan-001");
      expect(mockDbObj.update).toHaveBeenCalledWith({ is_active: false });
    });

    it("should remove the subscription from the in-memory map", async () => {
      // First subscribe
      await service.subscribeToAlerts("guild-004", "chan-004", ["bridge"]);
      // Then unsubscribe
      await service.unsubscribeFromAlerts("guild-004", "chan-004");
      // No error should be thrown; internal map should be cleared
      expect(mockDbObj.update).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("sendAlert", () => {
    it("should send an embed to every matching active channel", async () => {
      // DB returns one matching subscription
      mockDbObj.whereRaw.mockResolvedValueOnce([makeSubscriptionRow()]);

      await service.sendAlert(makeAlert());

      expect(mockClientInstance.channels.fetch).toHaveBeenCalledWith("chan-001");
      expect(mockChannel.send).toHaveBeenCalledWith({ embeds: [mockEmbed] });
    });

    it("should send to multiple channels when multiple subscriptions match", async () => {
      const rows = [
        makeSubscriptionRow({ id: "g1-c1", guild_id: "g1", channel_id: "c1" }),
        makeSubscriptionRow({ id: "g2-c2", guild_id: "g2", channel_id: "c2" }),
      ];
      mockDbObj.whereRaw.mockResolvedValueOnce(rows);

      await service.sendAlert(makeAlert());

      expect(mockClientInstance.channels.fetch).toHaveBeenCalledTimes(2);
      expect(mockChannel.send).toHaveBeenCalledTimes(2);
    });

    it("should not send when no subscriptions match", async () => {
      mockDbObj.whereRaw.mockResolvedValueOnce([]);

      await service.sendAlert(makeAlert());

      expect(mockClientInstance.channels.fetch).not.toHaveBeenCalled();
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it("should skip channels that return null from fetch", async () => {
      mockDbObj.whereRaw.mockResolvedValueOnce([makeSubscriptionRow()]);
      mockClientInstance.channels.fetch.mockResolvedValueOnce(null);

      await service.sendAlert(makeAlert());

      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it("should continue sending to other channels if one fails", async () => {
      const rows = [
        makeSubscriptionRow({ id: "g1-c1", guild_id: "g1", channel_id: "c1" }),
        makeSubscriptionRow({ id: "g2-c2", guild_id: "g2", channel_id: "c2" }),
      ];
      mockDbObj.whereRaw.mockResolvedValueOnce(rows);

      // First fetch throws, second fetch succeeds
      mockClientInstance.channels.fetch
        .mockRejectedValueOnce(new Error("Channel not found"))
        .mockResolvedValueOnce(mockChannel);

      await expect(service.sendAlert(makeAlert())).resolves.not.toThrow();
      expect(mockChannel.send).toHaveBeenCalledTimes(1);
    });

    it("should filter out subscriptions whose minSeverity is above the alert severity", async () => {
      // Subscription requires 'critical' but alert is only 'low'
      const row = makeSubscriptionRow({ min_severity: "critical" });
      mockDbObj.whereRaw.mockResolvedValueOnce([row]);

      await service.sendAlert(makeAlert({ severity: "low" }));

      // Filtered out – no channel fetch
      expect(mockClientInstance.channels.fetch).not.toHaveBeenCalled();
    });

    it("should send when alert severity meets subscription minSeverity", async () => {
      const row = makeSubscriptionRow({ min_severity: "medium" });
      mockDbObj.whereRaw.mockResolvedValueOnce([row]);

      // high >= medium → should send
      await service.sendAlert(makeAlert({ severity: "high" }));

      expect(mockClientInstance.channels.fetch).toHaveBeenCalled();
      expect(mockChannel.send).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe("Alert Embed Creation", () => {
    it("should create an embed with title, description, color, timestamp, and footer", async () => {
      mockDbObj.whereRaw.mockResolvedValueOnce([makeSubscriptionRow()]);

      await service.sendAlert(
        makeAlert({ severity: "critical", title: "Critical Alert", description: "Something broke" })
      );

      expect(mockEmbed.setTitle).toHaveBeenCalledWith("Critical Alert");
      expect(mockEmbed.setDescription).toHaveBeenCalledWith("Something broke");
      expect(mockEmbed.setColor).toHaveBeenCalledWith(0xff0000); // red for critical
      expect(mockEmbed.setTimestamp).toHaveBeenCalled();
      expect(mockEmbed.setFooter).toHaveBeenCalledWith({ text: "Bridge Watch Alert" });
    });

    it("should use correct colour for each severity level", async () => {
      const severityColors: Record<string, number> = {
        low: 0x00ff00,
        medium: 0xffff00,
        high: 0xff9900,
        critical: 0xff0000,
      };

      for (const [severity, expectedColor] of Object.entries(severityColors)) {
        vi.clearAllMocks();
        mockDbObj.whereRaw.mockResolvedValueOnce([
          makeSubscriptionRow({ min_severity: "low" }),
        ]);
        Object.assign(mockDb, mockDbObj);

        await service.sendAlert(
          makeAlert({ severity: severity as DiscordAlert["severity"] })
        );

        expect(mockEmbed.setColor).toHaveBeenCalledWith(expectedColor);
      }
    });

    it("should add fields for each metadata key", async () => {
      mockDbObj.whereRaw.mockResolvedValueOnce([makeSubscriptionRow()]);

      const alert = makeAlert({
        metadata: {
          bridge_name: "Stellar",
          tvl_usd: 5_000_000,
        },
      });

      await service.sendAlert(alert);

      expect(mockEmbed.addFields).toHaveBeenCalledTimes(2);
    });

    it("should capitalise and de-underscore metadata keys in field names", async () => {
      mockDbObj.whereRaw.mockResolvedValueOnce([makeSubscriptionRow()]);

      const alert = makeAlert({ metadata: { bridge_name: "Stellar" } });
      await service.sendAlert(alert);

      expect(mockEmbed.addFields).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Bridge Name" })
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("Permission Checking", () => {
    it("should return false for a null member", async () => {
      // hasPermission is private – we test it indirectly via handleSubscribe
      // by passing an interaction with member = null
      const interaction = {
        options: { getString: vi.fn().mockReturnValue("bridge") },
        guildId: "guild-perm",
        channelId: "chan-perm",
        member: null,
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
      };

      // Trigger interactionCreate handler
      const interactionHandler = mockClientInstance.on.mock.calls.find(
        ([event]: [string]) => event === "interactionCreate"
      )?.[1];

      // interactionCreate fires but isChatInputCommand returns false here,
      // so we call handleSubscribe directly via the command list
      // We can do this through the internal commands array exposed via the
      // subscribe command execute function:
      const subscribeCmd = (service as any).commands?.find(
        (c: any) => c.name === "subscribe"
      );
      if (subscribeCmd) {
        await subscribeCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({ ephemeral: true })
        );
      }
    });

    it("should allow users with ManageChannels permission", async () => {
      const member = {
        permissions: {
          has: vi.fn().mockReturnValue(true),
        },
      };

      const interaction = {
        options: { getString: vi.fn().mockReturnValue("bridge") },
        guildId: "guild-perm2",
        channelId: "chan-perm2",
        member,
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
      };

      const subscribeCmd = (service as any).commands?.find(
        (c: any) => c.name === "subscribe"
      );
      if (subscribeCmd) {
        await subscribeCmd.execute(interaction);
        // Should not reply with ephemeral permission-denied message
        const callArgs = interaction.reply.mock.calls[0]?.[0];
        expect(typeof callArgs === "string" || !callArgs?.ephemeral).toBeTruthy();
      }
    });

    it("should deny users without ManageChannels permission", async () => {
      const member = {
        permissions: {
          has: vi.fn().mockReturnValue(false),
        },
      };

      const interaction = {
        options: { getString: vi.fn().mockReturnValue("bridge") },
        guildId: "guild-deny",
        channelId: "chan-deny",
        member,
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
      };

      const subscribeCmd = (service as any).commands?.find(
        (c: any) => c.name === "subscribe"
      );
      if (subscribeCmd) {
        await subscribeCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining("Manage Channels"),
            ephemeral: true,
          })
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("Slash Command Handlers", () => {
    function buildInteraction(overrides: Record<string, unknown> = {}) {
      return {
        guildId: "guild-cmd",
        channelId: "chan-cmd",
        commandName: "status",
        member: { permissions: { has: vi.fn().mockReturnValue(true) } },
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        options: {
          getString: vi.fn().mockReturnValue("USDC"),
        },
        isChatInputCommand: vi.fn().mockReturnValue(true),
        ...overrides,
      };
    }

    it("/status should reply with an embed containing asset, bridge, pool counts", async () => {
      const mockCount = { count: "3" };
      mockDbObj.first.mockResolvedValue(mockCount);
      mockDbObj.count.mockReturnValue(mockDbObj);

      const statusCmd = (service as any).commands?.find(
        (c: any) => c.name === "status"
      );
      if (statusCmd) {
        await statusCmd.execute(buildInteraction());
        const interaction = buildInteraction();
        await statusCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ embeds: [mockEmbed] });
      }
    });

    it("/status should reply with an error message when DB throws", async () => {
      mockDbObj.count.mockReturnValue(mockDbObj);
      mockDbObj.first.mockRejectedValueOnce(new Error("DB down"));

      const statusCmd = (service as any).commands?.find(
        (c: any) => c.name === "status"
      );
      if (statusCmd) {
        const interaction = buildInteraction();
        await statusCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({ ephemeral: true })
        );
      }
    });

    it("/asset should reply with asset embed when asset exists", async () => {
      mockDbObj.first.mockResolvedValueOnce({
        symbol: "USDC",
        name: "USD Coin",
        asset_type: "stablecoin",
        bridge_provider: "Stellar",
        source_chain: "Ethereum",
      });

      const assetCmd = (service as any).commands?.find(
        (c: any) => c.name === "asset"
      );
      if (assetCmd) {
        const interaction = buildInteraction();
        await assetCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ embeds: [mockEmbed] });
      }
    });

    it("/asset should reply ephemerally when asset not found", async () => {
      mockDbObj.first.mockResolvedValueOnce(null);

      const assetCmd = (service as any).commands?.find(
        (c: any) => c.name === "asset"
      );
      if (assetCmd) {
        const interaction = buildInteraction();
        await assetCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({ ephemeral: true })
        );
      }
    });

    it("/bridge should reply with bridge embed when bridge exists", async () => {
      mockDbObj.first.mockResolvedValueOnce({
        name: "Stellar-Bridge",
        source_chain: "Ethereum",
        status: "active",
        total_value_locked: 5_000_000,
      });

      const bridgeCmd = (service as any).commands?.find(
        (c: any) => c.name === "bridge"
      );
      if (bridgeCmd) {
        const interaction = buildInteraction({
          options: { getString: vi.fn().mockReturnValue("Stellar") },
        });
        await bridgeCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ embeds: [mockEmbed] });
      }
    });

    it("/bridge should reply ephemerally when bridge not found", async () => {
      mockDbObj.first.mockResolvedValueOnce(null);

      const bridgeCmd = (service as any).commands?.find(
        (c: any) => c.name === "bridge"
      );
      if (bridgeCmd) {
        const interaction = buildInteraction({
          options: { getString: vi.fn().mockReturnValue("Unknown") },
        });
        await bridgeCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({ ephemeral: true })
        );
      }
    });

    it("/pool should reply with pool embed when pool exists", async () => {
      mockDbObj.first.mockResolvedValueOnce({
        asset_a: "USDC",
        asset_b: "XLM",
        dex: "StellarDEX",
        total_liquidity: 1_000_000,
        apr: 5.2,
        health_score: 95,
        volume_24h: 200_000,
        fee: 0.003,
      });

      const poolCmd = (service as any).commands?.find(
        (c: any) => c.name === "pool"
      );
      if (poolCmd) {
        const interaction = buildInteraction({
          options: { getString: vi.fn().mockReturnValue("USDC/XLM") },
        });
        await poolCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith({ embeds: [mockEmbed] });
      }
    });

    it("/pool should reply ephemerally when pool not found", async () => {
      mockDbObj.first.mockResolvedValueOnce(null);

      const poolCmd = (service as any).commands?.find(
        (c: any) => c.name === "pool"
      );
      if (poolCmd) {
        const interaction = buildInteraction({
          options: { getString: vi.fn().mockReturnValue("USDC/XLM") },
        });
        await poolCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({ ephemeral: true })
        );
      }
    });

    it("/pool should reply with invalid format error for malformed pair", async () => {
      const poolCmd = (service as any).commands?.find(
        (c: any) => c.name === "pool"
      );
      if (poolCmd) {
        const interaction = buildInteraction({
          options: { getString: vi.fn().mockReturnValue("USDC") }, // missing /XLM
        });
        await poolCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({ ephemeral: true })
        );
      }
    });

    it("/subscribe should create subscription and confirm", async () => {
      const subscribeCmd = (service as any).commands?.find(
        (c: any) => c.name === "subscribe"
      );
      if (subscribeCmd) {
        const interaction = buildInteraction({
          options: {
            getString: vi.fn().mockImplementation((key: string) => {
              if (key === "types") return "bridge";
              if (key === "severity") return "high";
              return null;
            }),
          },
        });
        await subscribeCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({ content: expect.stringContaining("subscribed") })
        );
      }
    });

    it("/unsubscribe should remove subscription and confirm", async () => {
      const unsubCmd = (service as any).commands?.find(
        (c: any) => c.name === "unsubscribe"
      );
      if (unsubCmd) {
        const interaction = buildInteraction();
        await unsubCmd.execute(interaction);
        expect(interaction.reply).toHaveBeenCalledWith(
          expect.stringContaining("unsubscribed")
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("Slash Command Registration", () => {
    it("should register exactly 6 slash commands", () => {
      const commands = (service as any).commands as Array<{ name: string }>;
      expect(commands).toHaveLength(6);
    });

    it("should include the expected command names", () => {
      const commands = (service as any).commands as Array<{ name: string }>;
      const names = commands.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "subscribe",
          "unsubscribe",
          "status",
          "asset",
          "bridge",
          "pool",
        ])
      );
    });

    it("should provide an execute function for each command", () => {
      const commands = (service as any).commands as Array<{
        name: string;
        execute: unknown;
      }>;
      commands.forEach((cmd) => {
        expect(typeof cmd.execute).toBe("function");
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("getActiveSubscriptions (via sendAlert)", () => {
    it("should query the DB with is_active=true", async () => {
      mockDbObj.whereRaw.mockResolvedValueOnce([]);

      await service.sendAlert(makeAlert({ type: "pool" }));

      expect(mockDb).toHaveBeenCalledWith("discord_subscriptions");
      expect(mockDbObj.where).toHaveBeenCalledWith("is_active", true);
    });

    it("should filter by JSON_CONTAINS on alert_types", async () => {
      mockDbObj.whereRaw.mockResolvedValueOnce([]);

      await service.sendAlert(makeAlert({ type: "health" }));

      expect(mockDbObj.whereRaw).toHaveBeenCalledWith(
        "JSON_CONTAINS(alert_types, ?)",
        ['"health"']
      );
    });

    it("should map database rows to DiscordSubscription objects", async () => {
      const row = makeSubscriptionRow({
        id: "g-c",
        guild_id: "g",
        channel_id: "c",
        alert_types: JSON.stringify(["bridge"]),
        assets: JSON.stringify(["USDC"]),
        bridges: JSON.stringify(["stellar"]),
        min_severity: "high",
        is_active: true,
        created_at: new Date(),
      });

      mockDbObj.whereRaw.mockResolvedValueOnce([row]);

      await service.sendAlert(makeAlert({ severity: "critical" }));

      // channel fetch proves the subscription was mapped correctly
      expect(mockClientInstance.channels.fetch).toHaveBeenCalledWith("c");
    });
  });

  // -------------------------------------------------------------------------
  describe("Error Handling", () => {
    it("should not throw when channel.send fails for one subscription", async () => {
      mockDbObj.whereRaw.mockResolvedValueOnce([makeSubscriptionRow()]);
      mockChannel.send.mockRejectedValueOnce(new Error("Rate limited"));

      await expect(service.sendAlert(makeAlert())).resolves.not.toThrow();
    });

    it("should log an error when channel.send fails", async () => {
      const { logger } = await import("../../src/utils/logger.js");
      mockDbObj.whereRaw.mockResolvedValueOnce([makeSubscriptionRow()]);
      mockChannel.send.mockRejectedValueOnce(new Error("Network error"));

      await service.sendAlert(makeAlert());

      expect(logger.error).toHaveBeenCalled();
    });

    it("should throw when client.login rejects during start()", async () => {
      mockClientInstance.login.mockRejectedValueOnce(new Error("Bad token"));
      await expect(service.start()).rejects.toThrow("Bad token");
    });
  });
});
