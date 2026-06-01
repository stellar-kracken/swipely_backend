import { randomUUID } from "crypto";
import { z } from "zod";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import type { OutboxEventType } from "../outbox/eventProducer.js";

export type EventSeverity = "info" | "warning" | "critical";
export type DeliveryChannel = "in_app" | "email" | "webhook" | "discord";

const FilterExpressionSchema = z.object({
  assets: z.array(z.string()).optional(),
  severities: z.array(z.enum(["info", "warning", "critical"])).optional(),
  sources: z.array(z.string()).optional(),
  eventTypes: z.array(z.string()).optional(),
  channels: z.array(z.enum(["in_app", "email", "webhook", "discord"])).optional(),
});

export type FilterExpression = z.infer<typeof FilterExpressionSchema>;

export interface PlatformEvent {
  eventType: OutboxEventType | string;
  asset?: string;
  severity?: EventSeverity;
  source?: string;
  channel?: DeliveryChannel;
  payload?: Record<string, unknown>;
}

export interface EventSubscription {
  id: string;
  userId: string;
  name: string;
  filter: FilterExpression;
  deliveryChannels: DeliveryChannel[];
  deliveryDestination?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionAuditEntry {
  id: string;
  subscriptionId: string;
  userId: string;
  action: "created" | "updated" | "deleted" | "matched" | "preview";
  detail: string | null;
  timestamp: string;
}

export class EventSubscriptionFilterService {
  private db = getDatabase();

  validateFilter(filter: unknown): FilterExpression {
    return FilterExpressionSchema.parse(filter);
  }

  async create(input: {
    userId: string;
    name: string;
    filter: FilterExpression;
    deliveryChannels?: DeliveryChannel[];
    deliveryDestination?: string;
  }): Promise<EventSubscription> {
    const filter = this.validateFilter(input.filter);
    const id = randomUUID();
    const now = new Date();

    await this.db("event_subscriptions").insert({
      id,
      user_id: input.userId,
      name: input.name,
      filter: JSON.stringify(filter),
      delivery_channels: input.deliveryChannels ?? ["in_app"],
      delivery_destination: input.deliveryDestination ?? null,
      enabled: true,
      created_at: now,
      updated_at: now,
    });

    await this.addAudit(id, input.userId, "created", `Created subscription "${input.name}"`);
    logger.info({ subscriptionId: id, userId: input.userId }, "Event subscription created");
    return this.getById(id, input.userId) as Promise<EventSubscription>;
  }

  async getById(id: string, userId: string): Promise<EventSubscription | null> {
    const row = await this.db("event_subscriptions")
      .where({ id, user_id: userId })
      .first();
    return row ? this.mapRow(row) : null;
  }

  async listByUser(userId: string): Promise<EventSubscription[]> {
    const rows = await this.db("event_subscriptions")
      .where({ user_id: userId })
      .orderBy("created_at", "desc");
    return rows.map((r) => this.mapRow(r));
  }

  async update(
    id: string,
    userId: string,
    input: {
      name?: string;
      filter?: FilterExpression;
      deliveryChannels?: DeliveryChannel[];
      deliveryDestination?: string;
      enabled?: boolean;
    },
  ): Promise<EventSubscription | null> {
    const existing = await this.getById(id, userId);
    if (!existing) return null;

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.filter !== undefined) updates.filter = JSON.stringify(this.validateFilter(input.filter));
    if (input.deliveryChannels !== undefined) updates.delivery_channels = input.deliveryChannels;
    if (input.deliveryDestination !== undefined) updates.delivery_destination = input.deliveryDestination;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    await this.db("event_subscriptions").where({ id, user_id: userId }).update(updates);
    await this.addAudit(id, userId, "updated", `Updated fields: ${Object.keys(input).join(", ")}`);
    return this.getById(id, userId);
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const deleted = await this.db("event_subscriptions").where({ id, user_id: userId }).delete();
    if (deleted > 0) {
      await this.addAudit(id, userId, "deleted", "Subscription deleted");
      return true;
    }
    return false;
  }

  matchesFilter(filter: FilterExpression, event: PlatformEvent): boolean {
    if (filter.assets?.length && event.asset && !filter.assets.includes(event.asset)) {
      return false;
    }
    if (filter.severities?.length && event.severity && !filter.severities.includes(event.severity)) {
      return false;
    }
    if (filter.sources?.length && event.source && !filter.sources.includes(event.source)) {
      return false;
    }
    if (filter.eventTypes?.length && !filter.eventTypes.includes(event.eventType)) {
      return false;
    }
    if (filter.channels?.length && event.channel && !filter.channels.includes(event.channel)) {
      return false;
    }
    return true;
  }

  async preview(
    userId: string,
    filter: FilterExpression,
    sampleEvents: PlatformEvent[],
    limit = 20,
  ): Promise<{ matched: PlatformEvent[]; total: number }> {
    const validated = this.validateFilter(filter);
    const matched = sampleEvents.filter((e) => this.matchesFilter(validated, e)).slice(0, limit);
    await this.addAudit("preview", userId, "preview", `Preview matched ${matched.length}/${sampleEvents.length} events`);
    return { matched, total: matched.length };
  }

  async getMatchingSubscriptions(event: PlatformEvent): Promise<EventSubscription[]> {
    const rows = await this.db("event_subscriptions").where({ enabled: true });
    const matched: EventSubscription[] = [];

    for (const row of rows) {
      const sub = this.mapRow(row);
      if (this.matchesFilter(sub.filter, event)) {
        matched.push(sub);
        await this.addAudit(sub.id, sub.userId, "matched", `Event ${event.eventType} matched`);
      }
    }

    return matched;
  }

  async getAuditTrail(subscriptionId: string): Promise<SubscriptionAuditEntry[]> {
    const rows = await this.db("event_subscription_audit_logs")
      .where({ subscription_id: subscriptionId })
      .orderBy("timestamp", "desc")
      .limit(100);
    return rows.map((r) => ({
      id: String(r.id),
      subscriptionId: String(r.subscription_id),
      userId: String(r.user_id),
      action: r.action as SubscriptionAuditEntry["action"],
      detail: r.detail ? String(r.detail) : null,
      timestamp:
        r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
    }));
  }

  private async addAudit(
    subscriptionId: string,
    userId: string,
    action: SubscriptionAuditEntry["action"],
    detail: string,
  ): Promise<void> {
    await this.db("event_subscription_audit_logs").insert({
      id: randomUUID(),
      subscription_id: subscriptionId,
      user_id: userId,
      action,
      detail,
      timestamp: new Date(),
    });
  }

  private mapRow(row: Record<string, unknown>): EventSubscription {
    const filter =
      typeof row.filter === "string" ? JSON.parse(row.filter) : (row.filter as FilterExpression);
    return {
      id: String(row.id),
      userId: String(row.user_id),
      name: String(row.name),
      filter,
      deliveryChannels: (row.delivery_channels as DeliveryChannel[]) ?? ["in_app"],
      deliveryDestination: row.delivery_destination ? String(row.delivery_destination) : undefined,
      enabled: Boolean(row.enabled),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at),
    };
  }
}

export const eventSubscriptionFilterService = new EventSubscriptionFilterService();
