/** Named test states available for fixture loading. */
export enum Fixture {
  /** One healthy bridge (Circle/USDC) with matching Stellar + Ethereum supplies. */
  HealthyBridge = "healthy-bridge",

  /** One degraded bridge with a 15% supply mismatch. */
  DegradedBridge = "degraded-bridge",

  /** Two bridges — one healthy, one down — for multi-bridge tests. */
  MixedBridgeHealth = "mixed-bridge-health",

  /** Healthy bridge with a pending reserve commitment (sequence 1). */
  PendingReserveCommitment = "pending-reserve-commitment",

  /** Healthy bridge with a verified reserve commitment. */
  VerifiedReserveCommitment = "verified-reserve-commitment",

  /** Multiple assets including native XLM, USDC (bridged), and EURC (bridged). */
  MultiAsset = "multi-asset",

  /** Minimal state — a single active asset, no bridges or commitments. */
  MinimalAsset = "minimal-asset",
}
