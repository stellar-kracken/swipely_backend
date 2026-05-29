/**
 * Backfill orchestration: drive large historical backfills without overwhelming
 * upstream providers or local infrastructure.
 *
 * The orchestrator is transport-agnostic — the caller injects a `processChunk`
 * worker (which hits Horizon, the DB, etc.) and the orchestrator handles
 * chunking, a concurrency limit, per-chunk retries with error recovery, resume
 * from already-completed chunks, a rate-limit delay between dispatches, and
 * progress/audit events. `sleep` is injectable so the logic is fully unit-testable.
 */

export interface BackfillChunk {
  index: number;
  /** Inclusive lower bound of the chunk (ledger / block / timestamp). */
  from: number;
  /** Exclusive upper bound of the chunk. */
  to: number;
}

export interface BackfillJobConfig {
  /** Inclusive start of the overall range to backfill. */
  rangeStart: number;
  /** Exclusive end of the overall range to backfill. */
  rangeEnd: number;
  /** Size of each chunk in range units (> 0). */
  chunkSize: number;
  /** Max chunks processed concurrently (>= 1). Default 1. */
  concurrency?: number;
  /** Retries attempted after the first failure, per chunk. Default 3. */
  maxRetries?: number;
  /** Delay (ms) before dispatching each chunk, to respect provider limits. Default 0. */
  minDelayMs?: number;
  /** Chunk indexes already completed in a previous run (resume support). */
  completedChunks?: number[];
}

export interface BackfillProgress {
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
  percent: number;
}

export type BackfillEvent =
  | { type: "chunk-start"; chunk: BackfillChunk; attempt: number }
  | { type: "chunk-success"; chunk: BackfillChunk }
  | { type: "chunk-error"; chunk: BackfillChunk; attempt: number; error: string }
  | { type: "chunk-failed"; chunk: BackfillChunk; error: string }
  | { type: "progress"; progress: BackfillProgress };

export interface BackfillDeps {
  /** Processes a single chunk; throw to signal a retryable failure. */
  processChunk: (chunk: BackfillChunk) => Promise<void>;
  /** Audit / progress sink. */
  onEvent?: (event: BackfillEvent) => void;
  /** Injectable sleep (defaults to setTimeout) for rate limiting + tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface BackfillResult {
  completedChunks: number[];
  failedChunks: number[];
  total: number;
}

function validate(config: BackfillJobConfig): void {
  if (!Number.isFinite(config.rangeStart) || !Number.isFinite(config.rangeEnd)) {
    throw new Error("backfill: rangeStart and rangeEnd must be finite numbers");
  }
  if (config.rangeEnd <= config.rangeStart) {
    throw new Error("backfill: rangeEnd must be greater than rangeStart");
  }
  if (!Number.isFinite(config.chunkSize) || config.chunkSize <= 0) {
    throw new Error(`backfill: chunkSize must be a positive number, got ${config.chunkSize}`);
  }
  if (config.concurrency !== undefined && config.concurrency < 1) {
    throw new Error(`backfill: concurrency must be >= 1, got ${config.concurrency}`);
  }
}

/** Split the configured range into ordered, non-overlapping chunks. */
export function planChunks(config: BackfillJobConfig): BackfillChunk[] {
  validate(config);
  const { rangeStart, rangeEnd, chunkSize } = config;
  const chunks: BackfillChunk[] = [];
  let index = 0;
  for (let from = rangeStart; from < rangeEnd; from += chunkSize) {
    chunks.push({ index, from, to: Math.min(from + chunkSize, rangeEnd) });
    index += 1;
  }
  return chunks;
}

/**
 * Run a backfill. Resolves once every chunk has either succeeded or exhausted
 * its retries. Chunks already in `completedChunks` are skipped (resume).
 */
export async function runBackfill(
  config: BackfillJobConfig,
  deps: BackfillDeps,
): Promise<BackfillResult> {
  const concurrency = config.concurrency ?? 1;
  const maxRetries = config.maxRetries ?? 3;
  const minDelayMs = config.minDelayMs ?? 0;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const allChunks = planChunks(config);
  const done = new Set<number>(config.completedChunks ?? []);
  const pending = allChunks.filter((c) => !done.has(c.index));

  const completed: number[] = [...(config.completedChunks ?? [])];
  const failed: number[] = [];
  let inFlight = 0;

  const emitProgress = () => {
    const settled = completed.length + failed.length;
    deps.onEvent?.({
      type: "progress",
      progress: {
        total: allChunks.length,
        completed: completed.length,
        failed: failed.length,
        inFlight,
        percent: allChunks.length === 0 ? 100 : Math.round((settled / allChunks.length) * 100),
      },
    });
  };

  async function processOne(chunk: BackfillChunk): Promise<void> {
    inFlight += 1;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      deps.onEvent?.({ type: "chunk-start", chunk, attempt });
      try {
        await deps.processChunk(chunk);
        deps.onEvent?.({ type: "chunk-success", chunk });
        completed.push(chunk.index);
        break;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        deps.onEvent?.({ type: "chunk-error", chunk, attempt, error });
        if (attempt > maxRetries) {
          deps.onEvent?.({ type: "chunk-failed", chunk, error });
          failed.push(chunk.index);
          break;
        }
      }
    }
    inFlight -= 1;
    emitProgress();
  }

  // Ordered dispatch (ascending index = priority) across a fixed worker pool,
  // with a rate-limit delay before each chunk is picked up.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const chunk = pending[cursor++];
      if (minDelayMs > 0) await sleep(minDelayMs);
      await processOne(chunk);
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, pending.length || 1));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  completed.sort((a, b) => a - b);
  failed.sort((a, b) => a - b);
  return { completedChunks: completed, failedChunks: failed, total: allChunks.length };
}
