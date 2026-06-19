/**
 * Federation health monitor.
 *
 * Aggregates per-source liveness data from all registered connectors into a
 * single FederationHealth snapshot used by the HTTP health endpoint and the
 * WebSocket `events` channel heartbeat.
 */

import type {
  IChainConnector,
  SourceLiveness,
  FederationHealth,
  FederationStatus,
} from "./types.js";
import type { EthereumConnector } from "./ethereumConnector.js";

const DEGRADED_GAP_MS = 120_000;
const OFFLINE_GAP_MS = 300_000;

export class FederationHealthMonitor {
  private readonly connectors: IChainConnector[];
  private readonly startedAt: number;

  constructor(connectors: IChainConnector[]) {
    this.connectors = connectors;
    this.startedAt = Date.now();
  }

  /**
   * Build a full health snapshot.
   * `totalEventsProcessed` and `dedupRejectedCount` are injected by the
   * caller (EventFederationService) which owns those counters.
   */
  snapshot({
    totalEventsProcessed,
    dedupRejectedCount,
    replayBufferSize,
  }: {
    totalEventsProcessed: number;
    dedupRejectedCount: number;
    replayBufferSize: number;
  }): FederationHealth {
    const sources = this._collectLiveness();
    const status = this._deriveStatus(sources);

    return {
      status,
      sources,
      totalEventsProcessed,
      dedupRejectedCount,
      replayBufferSize,
      uptimeMs: Date.now() - this.startedAt,
      checkedAt: new Date().toISOString(),
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private _collectLiveness(): SourceLiveness[] {
    const result: SourceLiveness[] = [];

    for (const connector of this.connectors) {
      // EthereumConnector exposes per-chain liveness
      if ("getAllLiveness" in connector) {
        const ethConnector = connector as EthereumConnector;
        result.push(...ethConnector.getAllLiveness());
      } else {
        result.push(connector.getLiveness());
      }
    }

    return result;
  }

  private _deriveStatus(sources: SourceLiveness[]): FederationStatus {
    if (sources.length === 0) return "offline";

    let degradedCount = 0;
    let offlineCount = 0;

    for (const s of sources) {
      if (s.status === "offline") {
        offlineCount++;
      } else if (
        s.status === "degraded" ||
        (s.gapMs !== null && s.gapMs > DEGRADED_GAP_MS)
      ) {
        if (s.gapMs !== null && s.gapMs > OFFLINE_GAP_MS) {
          offlineCount++;
        } else {
          degradedCount++;
        }
      }
    }

    if (offlineCount === sources.length) return "offline";
    if (offlineCount > 0 || degradedCount > 0) return "degraded";
    return "healthy";
  }
}
