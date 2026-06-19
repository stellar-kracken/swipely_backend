/**
 * Unified event schema for the real-time event stream federation.
 *
 * All chain-native events (Stellar payments/ledgers, Ethereum blocks/transfers,
 * and any future chains) are normalised into FederatedEvent before being
 * deduplicated, ordered, buffered, and fanned out to WebSocket subscribers.
 */

// ─── Chain identifiers ────────────────────────────────────────────────────────

export type ChainId = "stellar" | "ethereum" | "polygon" | "base" | string;

// ─── Event types ──────────────────────────────────────────────────────────────

export type FederatedEventType =
  | "payment"
  | "ledger_close"
  | "block"
  | "transfer"
  | "swap"
  | "bridge_lock"
  | "bridge_release"
  | "generic";

// ─── Core unified event ───────────────────────────────────────────────────────

export interface FederatedEvent {
  /** Globally unique: `{chain}:{type}:{sourceId}` */
  id: string;
  chain: ChainId;
  type: FederatedEventType;
  /** Chain-native block or ledger sequence number */
  blockNumber: number;
  /** ISO-8601 wall-clock timestamp of the on-chain event */
  timestamp: string;
  /** Initiating address or account */
  from?: string;
  /** Destination address or account */
  to?: string;
  /** Normalised asset code (e.g. "USDC", "ETH", "XLM") */
  assetCode?: string;
  /** Human-readable amount (decimals already divided out) */
  amount?: string;
  /** Chain-native tx/operation/ledger identifier */
  sourceId: string;
  /** Verbatim chain-native payload preserved for replay and audit */
  raw: Record<string, unknown>;
}

// ─── Source liveness ──────────────────────────────────────────────────────────

export type SourceStatus = "live" | "degraded" | "offline";

export interface SourceLiveness {
  chain: ChainId;
  status: SourceStatus;
  /** ISO-8601 time of the most recently processed event, or null if none yet */
  lastEventAt: string | null;
  /** Milliseconds since the last event (null when no events seen yet) */
  gapMs: number | null;
  eventsReceived: number;
  errorsCount: number;
  reconnectCount: number;
}

// ─── Federation health snapshot ───────────────────────────────────────────────

export type FederationStatus = "healthy" | "degraded" | "offline";

export interface FederationHealth {
  status: FederationStatus;
  sources: SourceLiveness[];
  totalEventsProcessed: number;
  dedupRejectedCount: number;
  replayBufferSize: number;
  uptimeMs: number;
  checkedAt: string;
}

// ─── Connector interface ──────────────────────────────────────────────────────

export interface IChainConnector {
  readonly chainId: ChainId;
  /** Called when a normalised event is ready for federation. */
  onEvent: ((event: FederatedEvent) => void) | null;
  /** Called when the connector encounters a non-fatal error. */
  onError: ((err: Error) => void) | null;
  start(cursor?: string): Promise<void>;
  stop(): Promise<void>;
  getLiveness(): SourceLiveness;
}

// ─── Replay request ───────────────────────────────────────────────────────────

export interface ReplayRequest {
  /** Only replay events from this chain (omit to replay all chains) */
  chain?: ChainId;
  /** Replay events with blockNumber >= this value */
  fromBlock?: number;
  /** ISO-8601 replay events newer than this timestamp */
  since?: string;
  /** Maximum number of events to return (default 200, max 1000) */
  limit?: number;
}
