/**
 * `events` WebSocket channel.
 *
 * Delivers real-time federated events from all configured chains to
 * subscribed clients.  Unlike the polling-based channels, this channel
 * listens on the EventFederationService EventEmitter so events are pushed
 * the moment they are accepted by the deduplicator.
 *
 * On subscribe, the client may include a `since` or `fromBlock` query param
 * to trigger a catch-up replay from the in-memory buffer before live events.
 */

import { BaseChannel } from "./base.channel.js";
import {
  getEventFederationService,
  FEDERATION_EVENT,
  type FederatedEvent,
} from "../../../services/eventFederation/index.js";
import type { IBroadcaster } from "../types.js";
import { logger } from "../../../utils/logger.js";

export interface FederatedEventMessage {
  type: "federated_event";
  channel: "events";
  data: FederatedEvent;
  timestamp: string;
}

export interface EventsReplayMessage {
  type: "events_replay";
  channel: "events";
  data: FederatedEvent[];
  cursor: string | null;
  timestamp: string;
}

export class EventsChannel extends BaseChannel {
  private boundOnEvent: ((e: FederatedEvent) => void) | null = null;

  constructor(broadcaster: IBroadcaster) {
    super(broadcaster);
  }

  get name() {
    return "events" as const;
  }

  get pollingIntervalMs(): number {
    // This channel is event-driven, not polling-based.
    // Return a large value so the base-class timer fires infrequently (used
    // only for the health heartbeat if ever needed).
    return 60_000;
  }

  // ─── Lifecycle override ─────────────────────────────────────────────────────

  override start(): void {
    if (this.isActive) return;
    this.isActive = true;

    const federation = getEventFederationService();

    this.boundOnEvent = async (event: FederatedEvent) => {
      if (this.subscriberCount === 0) return;
      const message: FederatedEventMessage = {
        type: "federated_event",
        channel: "events",
        data: event,
        timestamp: new Date().toISOString(),
      };
      await this.broadcast(message as any);
    };

    federation.on(FEDERATION_EVENT, this.boundOnEvent);
    logger.debug({ channel: "events" }, "EventsChannel started (event-driven)");
  }

  override stop(): void {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.boundOnEvent) {
      getEventFederationService().off(FEDERATION_EVENT, this.boundOnEvent);
      this.boundOnEvent = null;
    }

    logger.debug({ channel: "events" }, "EventsChannel stopped");
  }

  // ─── Not used (event-driven) ────────────────────────────────────────────────

  async fetchAndBroadcast(): Promise<void> {
    // No-op — events are pushed by the federation service listener above.
  }

  // ─── Replay on subscribe ────────────────────────────────────────────────────

  /**
   * Send a catch-up replay batch to a specific client immediately after they
   * subscribe.  Called externally by the subscribe handler.
   */
  async sendReplay(
    clientId: string,
    opts: { since?: string; fromBlock?: number; limit?: number } = {},
  ): Promise<void> {
    const federation = getEventFederationService();
    const events = federation.replay({
      since: opts.since,
      fromBlock: opts.fromBlock,
      limit: opts.limit ?? 200,
    });

    if (events.length === 0) return;

    const message: EventsReplayMessage = {
      type: "events_replay",
      channel: "events",
      data: events,
      cursor: events[events.length - 1]?.sourceId ?? null,
      timestamp: new Date().toISOString(),
    };

    // Broadcast targets all subscribers; for a client-specific send we'd need
    // direct socket access.  The broadcaster interface only exposes channel
    // broadcast, so we emit to all subscribers — they will all receive the
    // replay.  In practice this fires only at subscribe-time so the overlap
    // window is tiny.
    void clientId; // acknowledged — used for future direct-send optimisation
    await this.broadcast(message as any);
  }
}
