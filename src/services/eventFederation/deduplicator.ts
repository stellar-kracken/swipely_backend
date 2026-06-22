/**
 * Event deduplication and global ordering.
 *
 * The deduplicator maintains a sliding-window set of seen event IDs.  Events
 * whose ID has been seen within the window are dropped.  Accepted events are
 * sorted by (timestamp ASC, blockNumber ASC) before being returned so callers
 * always receive a causally consistent sequence regardless of source jitter.
 */

import type { FederatedEvent } from "./types.js";

const DEFAULT_WINDOW_SIZE = 10_000;

export class EventDeduplicator {
  /** FIFO ring of recently seen IDs for eviction. */
  private readonly ring: string[];
  private ringHead = 0;
  private readonly seenIds: Set<string>;
  private readonly windowSize: number;

  private _totalSeen = 0;
  private _duplicatesRejected = 0;

  constructor(windowSize = DEFAULT_WINDOW_SIZE) {
    this.windowSize = windowSize;
    this.ring = new Array<string>(windowSize).fill("");
    this.seenIds = new Set();
  }

  /**
   * Filter and sort a batch of events.
   *
   * Returns a new array containing only previously-unseen events, ordered by
   * timestamp (ascending) and then blockNumber (ascending) to provide a
   * globally consistent stream across chains with differing clock precision.
   */
  process(events: FederatedEvent[]): FederatedEvent[] {
    const unique: FederatedEvent[] = [];

    for (const event of events) {
      this._totalSeen++;
      if (this.seenIds.has(event.id)) {
        this._duplicatesRejected++;
        continue;
      }
      this.admit(event.id);
      unique.push(event);
    }

    return unique.sort(compareEvents);
  }

  /**
   * Test a single event without admitting it — useful for peek-ahead checks.
   */
  isDuplicate(event: FederatedEvent): boolean {
    return this.seenIds.has(event.id);
  }

  /**
   * Admit a single event (used when an event bypasses `process`, e.g. replays).
   */
  admit(id: string): void {
    // Evict the oldest entry if the window is full
    const evicted = this.ring[this.ringHead];
    if (evicted) this.seenIds.delete(evicted);

    this.ring[this.ringHead] = id;
    this.ringHead = (this.ringHead + 1) % this.windowSize;
    this.seenIds.add(id);
  }

  get totalSeen(): number {
    return this._totalSeen;
  }

  get duplicatesRejected(): number {
    return this._duplicatesRejected;
  }

  reset(): void {
    this.seenIds.clear();
    this.ring.fill("");
    this.ringHead = 0;
    this._totalSeen = 0;
    this._duplicatesRejected = 0;
  }
}

// ─── Comparator ───────────────────────────────────────────────────────────────

function compareEvents(a: FederatedEvent, b: FederatedEvent): number {
  const tA = new Date(a.timestamp).getTime();
  const tB = new Date(b.timestamp).getTime();
  if (tA !== tB) return tA - tB;
  return a.blockNumber - b.blockNumber;
}
