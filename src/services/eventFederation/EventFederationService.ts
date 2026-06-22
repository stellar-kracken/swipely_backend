/**
 * Real-Time Event Stream Federation Service
 *
 * Central orchestrator that:
 *  1. Starts all chain connectors (Stellar, Ethereum/EVM, future chains)
 *  2. Passes each raw event through deduplication and global ordering
 *  3. Stores accepted events in the replay buffer for catch-up
 *  4. Fans out to registered listeners (WebSocket channel, external consumers)
 *  5. Exposes federation health via FederationHealthMonitor
 */

import { EventEmitter } from "events";
import { StellarConnector } from "./stellarConnector.js";
import { EthereumConnector } from "./ethereumConnector.js";
import { EventDeduplicator } from "./deduplicator.js";
import { ReplayBuffer } from "./replayBuffer.js";
import { FederationHealthMonitor } from "./federationHealth.js";
import type {
  FederatedEvent,
  FederationHealth,
  IChainConnector,
  ReplayRequest,
} from "./types.js";
import { logger } from "../../utils/logger.js";

export const FEDERATION_EVENT = "event" as const;
export const FEDERATION_HEALTH_EVENT = "health" as const;

const HEALTH_BROADCAST_INTERVAL_MS = 30_000;

export class EventFederationService extends EventEmitter {
  private readonly connectors: IChainConnector[];
  private readonly deduplicator: EventDeduplicator;
  private readonly replayBuffer: ReplayBuffer;
  private readonly healthMonitor: FederationHealthMonitor;

  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private totalProcessed = 0;

  constructor({
    dedupeWindowSize = 10_000,
    replayCapacity = 2_000,
  }: {
    dedupeWindowSize?: number;
    replayCapacity?: number;
  } = {}) {
    super();
    this.setMaxListeners(100);

    this.deduplicator = new EventDeduplicator(dedupeWindowSize);
    this.replayBuffer = new ReplayBuffer(replayCapacity);

    const stellar = new StellarConnector();
    const ethereum = new EthereumConnector();

    stellar.onEvent = (e) => this._ingest(e);
    stellar.onError = (err) => logger.warn({ chain: "stellar", err }, "Stellar connector error");

    ethereum.onEvent = (e) => this._ingest(e);
    ethereum.onError = (err) => logger.warn({ chain: "ethereum", err }, "Ethereum connector error");

    this.connectors = [stellar, ethereum];
    this.healthMonitor = new FederationHealthMonitor(this.connectors);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await Promise.allSettled(
      this.connectors.map((c) =>
        c.start().catch((err) => {
          logger.error({ chain: c.chainId, err }, "Connector failed to start");
        }),
      ),
    );

    this.healthTimer = setInterval(() => {
      this.emit(FEDERATION_HEALTH_EVENT, this.health());
    }, HEALTH_BROADCAST_INTERVAL_MS);

    logger.info("EventFederationService started");
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    await Promise.allSettled(
      this.connectors.map((c) =>
        c.stop().catch((err) => {
          logger.error({ chain: c.chainId, err }, "Connector failed to stop cleanly");
        }),
      ),
    );

    logger.info("EventFederationService stopped");
  }

  // ─── Queries ─────────────────────────────────────────────────────────────────

  health(): FederationHealth {
    return this.healthMonitor.snapshot({
      totalEventsProcessed: this.totalProcessed,
      dedupRejectedCount: this.deduplicator.duplicatesRejected,
      replayBufferSize: this.replayBuffer.length,
    });
  }

  replay(req: ReplayRequest = {}): FederatedEvent[] {
    return this.replayBuffer.replay(req);
  }

  // ─── Event ingestion ──────────────────────────────────────────────────────────

  private _ingest(event: FederatedEvent): void {
    const accepted = this.deduplicator.process([event]);
    if (accepted.length === 0) return; // duplicate — drop

    for (const e of accepted) {
      this.totalProcessed++;
      this.replayBuffer.push(e);
      this.emit(FEDERATION_EVENT, e);
    }
  }
}
