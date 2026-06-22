/**
 * Replay / catch-up buffer.
 *
 * Stores recent federated events in an in-memory ring buffer so reconnecting
 * WebSocket clients can request a catch-up stream without hitting the chain
 * again.  Entries are evicted in FIFO order once the buffer reaches its
 * configured capacity.
 */

import type { FederatedEvent, ChainId, ReplayRequest } from "./types.js";

const DEFAULT_CAPACITY = 2_000;

export class ReplayBuffer {
  private readonly events: FederatedEvent[];
  private head = 0;
  private size = 0;
  private readonly capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.events = new Array<FederatedEvent>(capacity);
  }

  // ─── Write ──────────────────────────────────────────────────────────────────

  push(event: FederatedEvent): void {
    this.events[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  pushMany(events: FederatedEvent[]): void {
    for (const e of events) this.push(e);
  }

  // ─── Read ───────────────────────────────────────────────────────────────────

  /**
   * Return stored events matching the replay request, ordered by timestamp ASC.
   * The returned slice is limited to `req.limit` (default 200, hard-capped at 1 000).
   */
  replay(req: ReplayRequest = {}): FederatedEvent[] {
    const limit = Math.min(req.limit ?? 200, 1_000);
    const since = req.since ? new Date(req.since).getTime() : null;
    const fromBlock = req.fromBlock ?? null;
    const chain: ChainId | undefined = req.chain;

    const snapshot = this.snapshot();

    const filtered = snapshot.filter((e) => {
      if (chain && e.chain !== chain) return false;
      if (since !== null && new Date(e.timestamp).getTime() < since) return false;
      if (fromBlock !== null && e.blockNumber < fromBlock) return false;
      return true;
    });

    // Already in FIFO insertion order; slice to limit
    return filtered.slice(-limit);
  }

  /**
   * Returns the current buffer contents in insertion order (oldest first).
   */
  snapshot(): FederatedEvent[] {
    if (this.size === 0) return [];

    if (this.size < this.capacity) {
      return this.events.slice(0, this.size);
    }

    // Buffer is full — unwrap the ring
    const tail = (this.head - this.size + this.capacity) % this.capacity;
    if (tail === 0) {
      return this.events.slice();
    }
    return [...this.events.slice(tail), ...this.events.slice(0, tail)];
  }

  get length(): number {
    return this.size;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}
