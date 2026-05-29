import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

export type EntityType = "asset" | "bridge" | "service";
export type TriggerStatus = "degraded" | "down" | "recovered" | "any";
export type DeliveryChannel = "in_app" | "email" | "webhook" | "discord";
export type DigestFrequency = "immediate" | "hourly" | "daily";

export interface StatusSubscription {
  id: string;
  userId: string;
  entityType: EntityType;
  entityId: string;
  triggerStatuses: TriggerStatus[];
  deliveryChannels: DeliveryChannel[];
  deliveryDestination?: string;
  digestFrequency: DigestFrequency;
  suppressDuplicatesMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionCreateInput {
  userId: string;
  entityType: EntityType;
  entityId: string;
  triggerStatuses?: TriggerStatus[];
  deliveryChannels?: DeliveryChannel[];
  deliveryDestination?: string;
  digestFrequency?: DigestFrequency;
  suppressDuplicatesMinutes?: number;
}

export interface SubscriptionUpdateInput {
  triggerStatuses?: TriggerStatus[];
  deliveryChannels?: DeliveryChannel[];
  deliveryDestination?: string;
  digestFrequency?: DigestFrequency;
  suppressDuplicatesMinutes?: number;
  enabled?: boolean;
}

interface AuditEntry {
  id: string;
  subscriptionId: string;
  userId: string;
  action: "created" | "updated" | "deleted" | "triggered";
  detail: string;
  timestamp: string;
}

// In-memory store — replace with a DB-backed implementation when a migration is added.
const subscriptions = new Map<string, StatusSubscription>();
const auditLog: AuditEntry[] = [];
const lastTriggered = new Map<string, string>(); // subscriptionId → ISO timestamp

function now(): string {
  return new Date().toISOString();
}

function addAudit(
  subscriptionId: string,
  userId: string,
  action: AuditEntry["action"],
  detail: string,
): void {
  auditLog.push({ id: randomUUID(), subscriptionId, userId, action, detail, timestamp: now() });
  if (auditLog.length > 5000) auditLog.splice(0, 1000);
}

export class StatusSubscriptionService {
  create(input: SubscriptionCreateInput): StatusSubscription {
    const id = randomUUID();
    const ts = now();
    const sub: StatusSubscription = {
      id,
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      triggerStatuses: input.triggerStatuses ?? ["any"],
      deliveryChannels: input.deliveryChannels ?? ["in_app"],
      deliveryDestination: input.deliveryDestination,
      digestFrequency: input.digestFrequency ?? "immediate",
      suppressDuplicatesMinutes: input.suppressDuplicatesMinutes ?? 60,
      enabled: true,
      createdAt: ts,
      updatedAt: ts,
    };
    subscriptions.set(id, sub);
    addAudit(id, input.userId, "created", `Subscribed to ${input.entityType}:${input.entityId}`);
    logger.info({ subscriptionId: id, userId: input.userId }, "Status subscription created");
    return sub;
  }

  getById(id: string): StatusSubscription | undefined {
    return subscriptions.get(id);
  }

  listByUser(userId: string): StatusSubscription[] {
    return Array.from(subscriptions.values()).filter((s) => s.userId === userId);
  }

  listByEntity(entityType: EntityType, entityId: string): StatusSubscription[] {
    return Array.from(subscriptions.values()).filter(
      (s) => s.entityType === entityType && s.entityId === entityId && s.enabled,
    );
  }

  update(id: string, userId: string, input: SubscriptionUpdateInput): StatusSubscription | null {
    const sub = subscriptions.get(id);
    if (!sub || sub.userId !== userId) return null;

    const updated: StatusSubscription = {
      ...sub,
      ...(input.triggerStatuses !== undefined && { triggerStatuses: input.triggerStatuses }),
      ...(input.deliveryChannels !== undefined && { deliveryChannels: input.deliveryChannels }),
      ...(input.deliveryDestination !== undefined && { deliveryDestination: input.deliveryDestination }),
      ...(input.digestFrequency !== undefined && { digestFrequency: input.digestFrequency }),
      ...(input.suppressDuplicatesMinutes !== undefined && { suppressDuplicatesMinutes: input.suppressDuplicatesMinutes }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      updatedAt: now(),
    };
    subscriptions.set(id, updated);
    addAudit(id, userId, "updated", `Updated subscription fields: ${Object.keys(input).join(", ")}`);
    return updated;
  }

  delete(id: string, userId: string): boolean {
    const sub = subscriptions.get(id);
    if (!sub || sub.userId !== userId) return false;
    subscriptions.delete(id);
    addAudit(id, userId, "deleted", `Deleted subscription for ${sub.entityType}:${sub.entityId}`);
    return true;
  }

  /**
   * Called by the alerting layer when an entity's status changes.
   * Returns subscriptions that should receive notifications, after applying
   * duplicate-suppression logic.
   */
  getSubscriptionsToNotify(
    entityType: EntityType,
    entityId: string,
    newStatus: string,
  ): StatusSubscription[] {
    const candidates = this.listByEntity(entityType, entityId).filter((s) => {
      const matches =
        s.triggerStatuses.includes("any") ||
        s.triggerStatuses.includes(newStatus as TriggerStatus);
      if (!matches) return false;

      const lastTs = lastTriggered.get(s.id);
      if (lastTs) {
        const elapsedMinutes = (Date.now() - new Date(lastTs).getTime()) / 60_000;
        if (elapsedMinutes < s.suppressDuplicatesMinutes) return false;
      }
      return true;
    });

    for (const s of candidates) {
      lastTriggered.set(s.id, now());
      addAudit(s.id, s.userId, "triggered", `Status changed to ${newStatus} for ${entityType}:${entityId}`);
    }

    return candidates;
  }

  getAuditTrail(subscriptionId: string): AuditEntry[] {
    return auditLog.filter((e) => e.subscriptionId === subscriptionId);
  }
}
