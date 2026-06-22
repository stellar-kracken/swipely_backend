/**
 * Stellar source connector.
 *
 * Streams real-time payment operations and ledger close events from the
 * Stellar Horizon API, normalises each into a FederatedEvent, and invokes
 * the federation callback.  Reconnects automatically on error using
 * exponential back-off, and restores from the last known paging cursor so
 * no events are silently skipped during outages.
 */

import { getHorizonClient } from "../stellar/horizon.client.js";
import {
  normalizeStellarPayment,
  normalizeStellarLedger,
  type RawStellarPayment,
  type RawStellarLedger,
} from "./normalizer.js";
import type { FederatedEvent, IChainConnector, SourceLiveness } from "./types.js";
import { logger } from "../../utils/logger.js";

const GAP_THRESHOLD_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;

export class StellarConnector implements IChainConnector {
  readonly chainId = "stellar" as const;
  onEvent: ((event: FederatedEvent) => void) | null = null;
  onError: ((err: Error) => void) | null = null;

  private paymentCloser: (() => void) | null = null;
  private ledgerCloser: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private liveness: SourceLiveness = {
    chain: "stellar",
    status: "offline",
    lastEventAt: null,
    gapMs: null,
    eventsReceived: 0,
    errorsCount: 0,
    reconnectCount: 0,
  };

  private paymentCursor: string;
  private ledgerCursor: string;
  private running = false;
  private reconnectAttempt = 0;

  constructor(paymentCursor = "now", ledgerCursor = "now") {
    this.paymentCursor = paymentCursor;
    this.ledgerCursor = ledgerCursor;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async start(cursor?: string): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (cursor) {
      this.paymentCursor = cursor;
      this.ledgerCursor = cursor;
    }

    this.liveness.status = "live";
    this.reconnectAttempt = 0;
    this._openStreams();
    logger.info({ chain: "stellar", cursor }, "StellarConnector started");
  }

  async stop(): Promise<void> {
    this.running = false;
    this._closeStreams();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.liveness.status = "offline";
    logger.info({ chain: "stellar" }, "StellarConnector stopped");
  }

  getLiveness(): SourceLiveness {
    const now = Date.now();
    const last = this.liveness.lastEventAt
      ? new Date(this.liveness.lastEventAt).getTime()
      : null;
    this.liveness.gapMs = last !== null ? now - last : null;

    if (
      this.running &&
      this.liveness.gapMs !== null &&
      this.liveness.gapMs > GAP_THRESHOLD_MS
    ) {
      this.liveness.status = "degraded";
    }
    return { ...this.liveness };
  }

  // ─── Stream management ───────────────────────────────────────────────────────

  private _openStreams(): void {
    const client = getHorizonClient();

    this.paymentCloser = client.streamPayments(
      (raw) => {
        const payment = raw as unknown as RawStellarPayment;
        const event = normalizeStellarPayment(payment);
        if (payment.paging_token) this.paymentCursor = payment.paging_token;
        this._emit(event);
      },
      (err) => this._handleStreamError("payments", err),
      this.paymentCursor,
    );

    this.ledgerCloser = client.streamLedgers(
      (raw) => {
        const ledger = raw as unknown as RawStellarLedger;
        const event = normalizeStellarLedger(ledger);
        this.ledgerCursor = String(ledger.sequence);
        this._emit(event);
      },
      (err) => this._handleStreamError("ledgers", err),
      this.ledgerCursor,
    );
  }

  private _closeStreams(): void {
    this.paymentCloser?.();
    this.ledgerCloser?.();
    this.paymentCloser = null;
    this.ledgerCloser = null;
  }

  private _emit(event: FederatedEvent): void {
    this.liveness.eventsReceived++;
    this.liveness.lastEventAt = event.timestamp;
    this.liveness.status = "live";
    this.reconnectAttempt = 0;
    this.onEvent?.(event);
  }

  private _handleStreamError(stream: string, err: Error): void {
    this.liveness.errorsCount++;
    this.liveness.status = "degraded";
    logger.warn({ chain: "stellar", stream, err }, "Stellar stream error");
    this.onError?.(err);
    this._scheduleReconnect();
  }

  private _scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        { chain: "stellar", attempts: this.reconnectAttempt },
        "StellarConnector: max reconnect attempts reached",
      );
      this.liveness.status = "offline";
      return;
    }

    const delay = Math.min(
      BASE_BACKOFF_MS * 2 ** this.reconnectAttempt,
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempt++;
    this.liveness.reconnectCount++;

    logger.info(
      { chain: "stellar", attempt: this.reconnectAttempt, delayMs: delay },
      "StellarConnector reconnecting",
    );

    this._closeStreams();
    this.reconnectTimer = setTimeout(() => {
      if (this.running) this._openStreams();
    }, delay);
  }
}
