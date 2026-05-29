/**
 * State integrity checks for stored contract/bridge reserve data.
 *
 * Read-only, pure helpers that verify a captured reserve snapshot is internally
 * consistent (supply = reserve + circulating, balances reconcile, no negative
 * amounts, …). They never touch the chain or the DB themselves; a caller passes
 * in a snapshot and gets back a structured report with clear, actionable
 * messages. An optional `onViolation` hook fires per violation so monitors can
 * raise alerts as broken state is detected.
 */

export interface IntegrityViolation {
  /** Stable machine-readable code, e.g. "CIRCULATING_MISMATCH". */
  code: string;
  /** Human-readable explanation of what invariant was broken. */
  message: string;
  context?: Record<string, string>;
}

export interface IntegrityReport {
  ok: boolean;
  violations: IntegrityViolation[];
}

export interface IntegrityCheckOptions {
  /** Called once for each violation as it is detected (event hook). */
  onViolation?: (violation: IntegrityViolation) => void;
}

export interface HolderBalance {
  address: string;
  balance: bigint;
}

export interface ReserveStateSnapshot {
  assetCode: string;
  /** Total units ever issued (base units / stroops). */
  totalSupply: bigint;
  /** Units locked in the bridge reserve. */
  lockedReserve: bigint;
  /** Circulating supply the contract reports. */
  reportedCirculating: bigint;
  /** Optional per-holder balances; when present they must sum to circulating. */
  holderBalances?: HolderBalance[];
}

/**
 * Validate the key invariants of a reserve snapshot. Returns `{ ok, violations }`;
 * `ok` is true only when no invariant is broken.
 */
export function checkReserveIntegrity(
  snapshot: ReserveStateSnapshot,
  options: IntegrityCheckOptions = {},
): IntegrityReport {
  const violations: IntegrityViolation[] = [];
  const add = (code: string, message: string, context?: Record<string, string>) => {
    const violation: IntegrityViolation = { code, message, context };
    violations.push(violation);
    options.onViolation?.(violation);
  };

  const { assetCode, totalSupply, lockedReserve, reportedCirculating } = snapshot;
  const ctx = { assetCode };

  if (totalSupply < 0n) {
    add("NEGATIVE_SUPPLY", `${assetCode}: total supply is negative (${totalSupply})`, ctx);
  }
  if (lockedReserve < 0n) {
    add("NEGATIVE_RESERVE", `${assetCode}: locked reserve is negative (${lockedReserve})`, ctx);
  }
  if (reportedCirculating < 0n) {
    add("NEGATIVE_CIRCULATING", `${assetCode}: circulating supply is negative (${reportedCirculating})`, ctx);
  }
  if (lockedReserve > totalSupply) {
    add(
      "RESERVE_EXCEEDS_SUPPLY",
      `${assetCode}: locked reserve (${lockedReserve}) exceeds total supply (${totalSupply})`,
      ctx,
    );
  }

  const expectedCirculating = totalSupply - lockedReserve;
  if (reportedCirculating !== expectedCirculating) {
    add(
      "CIRCULATING_MISMATCH",
      `${assetCode}: reported circulating (${reportedCirculating}) != supply - reserve (${expectedCirculating})`,
      ctx,
    );
  }

  if (snapshot.holderBalances) {
    const seen = new Set<string>();
    let holderSum = 0n;
    for (const holder of snapshot.holderBalances) {
      if (seen.has(holder.address)) {
        add("DUPLICATE_HOLDER", `${assetCode}: holder ${holder.address} appears more than once`, {
          ...ctx,
          address: holder.address,
        });
      }
      seen.add(holder.address);
      if (holder.balance < 0n) {
        add("NEGATIVE_HOLDER_BALANCE", `${assetCode}: holder ${holder.address} has negative balance (${holder.balance})`, {
          ...ctx,
          address: holder.address,
        });
      }
      holderSum += holder.balance;
    }
    if (holderSum !== reportedCirculating) {
      add(
        "HOLDER_SUM_MISMATCH",
        `${assetCode}: holder balances sum to ${holderSum} but circulating is ${reportedCirculating}`,
        ctx,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
