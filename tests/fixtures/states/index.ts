import type { Knex } from "knex";
import { Fixture } from "../fixture-registry.js";
import { healthyBridge } from "./healthy-bridge.js";
import { degradedBridge } from "./degraded-bridge.js";
import { mixedBridgeHealth } from "./mixed-bridge-health.js";
import { pendingReserveCommitment } from "./pending-reserve-commitment.js";
import { verifiedReserveCommitment } from "./verified-reserve-commitment.js";
import { multiAsset } from "./multi-asset.js";
import { minimalAsset } from "./minimal-asset.js";

export const fixtures: Record<Fixture, (db: Knex) => Promise<void>> = {
  [Fixture.HealthyBridge]: healthyBridge,
  [Fixture.DegradedBridge]: degradedBridge,
  [Fixture.MixedBridgeHealth]: mixedBridgeHealth,
  [Fixture.PendingReserveCommitment]: pendingReserveCommitment,
  [Fixture.VerifiedReserveCommitment]: verifiedReserveCommitment,
  [Fixture.MultiAsset]: multiAsset,
  [Fixture.MinimalAsset]: minimalAsset,
};
