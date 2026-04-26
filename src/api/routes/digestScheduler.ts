import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth.js";
import { DigestSchedulerService } from "../../services/digestScheduler.service.js";

interface CreateSubscriptionBody {
  userAddress: string;
  email: string;
  dailyEnabled?: boolean;
  weeklyEnabled?: boolean;
  timezone?: string;
  preferredHour?: number;
  preferredDayOfWeek?: number;
  quietHours?: { start: number; end: number };
  includedAlertTypes?: string[];
  includedSeverities?: string[];
  includeTrends?: boolean;
  includeUnresolved?: boolean;
}

interface UpdateSubscriptionBody {
  dailyEnabled?: boolean;
  weeklyEnabled?: boolean;
  timezone?: string;
  preferredHour?: number;
  preferredDayOfWeek?: number;
  quietHours?: { start: number; end: number };
  includedAlertTypes?: string[];
  includedSeverities?: string[];
  includeTrends?: boolean;
  includeUnresolved?: boolean;
  isActive?: boolean;
}

export async function digestSchedulerRoutes(server: FastifyInstance) {
  const digestService = DigestSchedulerService.getInstance();
  const requireAuth = authMiddleware({ requiredScopes: [] }); // Any authenticated user

  // Get user's subscription
  server.get<{ Params: { userAddress: string } }>(
    "/subscriptions/:userAddress",
    { preHandler: requireAuth },
    async (request, reply) => {
      const subscription = await digestService.getSubscription(request.params.userAddress);
      if (!subscription) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Subscription not found",
        });
      }
      return { subscription };
    }
  );

  // Create subscription
  server.post<{ Body: CreateSubscriptionBody }>(
    "/subscriptions",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { userAddress, email, ...options } = request.body;

      if (!userAddress?.trim() || !email?.trim()) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "userAddress and email are required",
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Invalid email format",
        });
      }

      // Validate preferred hour (0-23)
      if (options.preferredHour !== undefined && (options.preferredHour < 0 || options.preferredHour > 23)) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "preferredHour must be between 0 and 23",
        });
      }

      // Validate preferred day of week (0-6)
      if (options.preferredDayOfWeek !== undefined && (options.preferredDayOfWeek < 0 || options.preferredDayOfWeek > 6)) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "preferredDayOfWeek must be between 0 (Sunday) and 6 (Saturday)",
        });
      }

      try {
        const subscription = await digestService.createSubscription({
          userAddress,
          email,
          ...options,
        });

        return reply.code(201).send({ subscription });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create subscription";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );

  // Update subscription
  server.patch<{ Params: { userAddress: string }; Body: UpdateSubscriptionBody }>(
    "/subscriptions/:userAddress",
    { preHandler: requireAuth },
    async (request, reply) => {
      const updates = request.body;

      // Validate preferred hour if provided
      if (updates.preferredHour !== undefined && (updates.preferredHour < 0 || updates.preferredHour > 23)) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "preferredHour must be between 0 and 23",
        });
      }

      // Validate preferred day of week if provided
      if (updates.preferredDayOfWeek !== undefined && (updates.preferredDayOfWeek < 0 || updates.preferredDayOfWeek > 6)) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "preferredDayOfWeek must be between 0 (Sunday) and 6 (Saturday)",
        });
      }

      try {
        const subscription = await digestService.updateSubscription(
          request.params.userAddress,
          updates
        );

        return { subscription };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update subscription";
        return reply.code(400).send({
          error: "Bad Request",
          message,
        });
      }
    }
  );

  // Delete subscription
  server.delete<{ Params: { userAddress: string } }>(
    "/subscriptions/:userAddress",
    { preHandler: requireAuth },
    async (request) => {
      await digestService.deleteSubscription(request.params.userAddress);
      return { success: true, message: "Subscription deleted" };
    }
  );

  // Get delivery history
  server.get<{ Params: { userAddress: string } }>(
    "/subscriptions/:userAddress/history",
    { preHandler: requireAuth },
    async (request) => {
      const limit = request.query && (request.query as any).limit ? parseInt((request.query as any).limit, 10) : 30;
      const deliveries = await digestService.getDeliveryHistory(request.params.userAddress, limit);
      return { deliveries };
    }
  );

  // Get unread count
  server.get<{ Params: { userAddress: string } }>(
    "/subscriptions/:userAddress/unread",
    { preHandler: requireAuth },
    async (request) => {
      const count = await digestService.getUnreadCount(request.params.userAddress);
      return { unreadCount: count };
    }
  );

  // Admin: List all active subscriptions
  server.get(
    "/subscriptions",
    { preHandler: authMiddleware({ requiredScopes: ["admin"] }) },
    async (request) => {
      const digestType = request.query && (request.query as any).digestType;
      const subscriptions = await digestService.listActiveSubscriptions(digestType);
      return { subscriptions };
    }
  );

  // Admin: Manually trigger digest generation
  server.post(
    "/generate",
    { preHandler: authMiddleware({ requiredScopes: ["admin"] }) },
    async (request, reply) => {
      const digestType = request.body && (request.body as any).digestType;

      if (!digestType || (digestType !== "daily" && digestType !== "weekly")) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "digestType must be 'daily' or 'weekly'",
        });
      }

      try {
        const generatedCount = await digestService.generateDigests(digestType);
        return { success: true, generatedCount };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate digests";
        return reply.code(500).send({
          error: "Internal Server Error",
          message,
        });
      }
    }
  );

  // Admin: Process pending deliveries
  server.post(
    "/process",
    { preHandler: authMiddleware({ requiredScopes: ["admin"] }) },
    async (request, reply) => {
      try {
        const processedCount = await digestService.processPendingDeliveries();
        return { success: true, processedCount };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process deliveries";
        return reply.code(500).send({
          error: "Internal Server Error",
          message,
        });
      }
    }
  );
}
