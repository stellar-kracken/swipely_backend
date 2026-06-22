/**
 * Ethereum / EVM source connector.
 *
 * Polls for new blocks on each configured EVM chain (Ethereum, Polygon, Base)
 * at a configurable interval, normalises block events into FederatedEvents,
 * and emits them to the federation.  Falls back gracefully when a chain has
 * no RPC URL configured (i.e. the EthereumRpcClient simply skips that chain).
 */

import { getEthereumRpcClient } from "../ethereum/client.js";
import { normalizeEthBlock, type RawEthBlock } from "./normalizer.js";
import type { FederatedEvent, IChainConnector, SourceLiveness, ChainId } from "./types.js";
import { logger } from "../../utils/logger.js";

const POLL_INTERVAL_MS = 12_000; // ~1 ETH block time
const GAP_THRESHOLD_MS = 120_000;

interface ChainState {
  liveness: SourceLiveness;
  lastBlock: number;
}

export class EthereumConnector implements IChainConnector {
  readonly chainId = "ethereum" as const;
  onEvent: ((event: FederatedEvent) => void) | null = null;
  onError: ((err: Error) => void) | null = null;

  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private readonly chains: ChainId[];
  private readonly state = new Map<ChainId, ChainState>();

  constructor(pollIntervalMs = POLL_INTERVAL_MS) {
    this.pollIntervalMs = pollIntervalMs;

    try {
      this.chains = getEthereumRpcClient().getSupportedChains();
    } catch {
      this.chains = [];
    }

    for (const chain of this.chains) {
      this.state.set(chain, {
        liveness: {
          chain,
          status: "offline",
          lastEventAt: null,
          gapMs: null,
          eventsReceived: 0,
          errorsCount: 0,
          reconnectCount: 0,
        },
        lastBlock: 0,
      });
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async start(_cursor?: string): Promise<void> {
    if (this.running || this.chains.length === 0) return;
    this.running = true;

    for (const s of this.state.values()) {
      s.liveness.status = "live";
    }

    await this._poll(); // immediate first poll
    this.timer = setInterval(() => {
      this._poll().catch((err) => {
        logger.warn({ err }, "EthereumConnector poll error");
      });
    }, this.pollIntervalMs);

    logger.info(
      { chains: this.chains, pollIntervalMs: this.pollIntervalMs },
      "EthereumConnector started",
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const s of this.state.values()) s.liveness.status = "offline";
    logger.info({ chains: this.chains }, "EthereumConnector stopped");
  }

  getLiveness(): SourceLiveness {
    // Return aggregate liveness for the primary chain, or a synthetic entry.
    const primary = this.state.get("ethereum") ?? [...this.state.values()][0];
    if (!primary) {
      return {
        chain: "ethereum",
        status: "offline",
        lastEventAt: null,
        gapMs: null,
        eventsReceived: 0,
        errorsCount: 0,
        reconnectCount: 0,
      };
    }
    this._refreshGap(primary);
    return { ...primary.liveness };
  }

  /** Per-chain liveness for health reporting. */
  getAllLiveness(): SourceLiveness[] {
    return [...this.state.values()].map((s) => {
      this._refreshGap(s);
      return { ...s.liveness };
    });
  }

  // ─── Polling ─────────────────────────────────────────────────────────────────

  private async _poll(): Promise<void> {
    if (!this.running) return;

    const client = getEthereumRpcClient();

    await Promise.allSettled(
      this.chains.map(async (chain) => {
        const s = this.state.get(chain)!;
        try {
          const blockNumber = await client.getBlockNumber(chain as any);
          if (blockNumber <= s.lastBlock) return;

          const block = await client.getBlock(chain as any, blockNumber);
          if (!block) return;

          const raw: RawEthBlock = {
            chain,
            number: blockNumber,
            hash: block.hash ?? "",
            timestamp: Number(block.timestamp),
            parentHash: block.parentHash,
            transactionCount: block.transactions?.length ?? 0,
          };

          const event = normalizeEthBlock(raw);
          s.lastBlock = blockNumber;
          s.liveness.eventsReceived++;
          s.liveness.lastEventAt = event.timestamp;
          s.liveness.status = "live";

          this.onEvent?.(event);
        } catch (err) {
          s.liveness.errorsCount++;
          s.liveness.status = "degraded";
          logger.warn({ chain, err }, "EthereumConnector poll failed for chain");
          this.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }),
    );
  }

  private _refreshGap(s: ChainState): void {
    const last = s.liveness.lastEventAt
      ? new Date(s.liveness.lastEventAt).getTime()
      : null;
    s.liveness.gapMs = last !== null ? Date.now() - last : null;
    if (
      this.running &&
      s.liveness.gapMs !== null &&
      s.liveness.gapMs > GAP_THRESHOLD_MS
    ) {
      s.liveness.status = "degraded";
    }
  }
}
