import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { redis } from "../utils/redis.js";
import { getStellarAssetSupply } from "../utils/stellar.js";
import { getEthereumRpcClient } from "./ethereum/client.js";
import { ReserveVerificationService, type MerkleProofInput } from "./reserveVerification.service.js";
import type { ChainId } from "./ethereum/types.js";

export type VerificationStatus = "verified" | "mismatch" | "error" | "stale" | "pending";

export interface EthereumChainState {
  blockNumber: number;
  lockedAmount: string;
  formattedAmount: string;
  isPaused: boolean;
  timestamp: number;
}

export interface StellarChainState {
  supply: number;
  assetCode: string;
  issuer: string;
}

export interface CrossChainStateResult {
  bridgeId: string;
  bridgeName: string;
  sourceChain: string;
  verifiedAt: string;
  ethereum: EthereumChainState | null;
  stellar: StellarChainState;
  merkleProofValid: boolean | null;
  latestCommitmentSequence: number | null;
  stateConsistent: boolean;
  mismatchPct: number;
  mismatchThreshold: number;
  status: VerificationStatus;
  cacheHit: boolean;
  freshnessSeconds: number;
  error?: string;
}

export interface ProofVerificationRequest {
  bridgeId: string;
  sequence: number;
  proof: MerkleProofInput;
}

const CACHE_KEY_PREFIX = "ccv:state:";
const CACHE_TTL_SECONDS = 300; // 5-minute freshness threshold
const MISMATCH_THRESHOLD_PCT = 2; // alert if supply differs by more than 2%

export class CrossChainStateVerificationService {
  private readonly db = getDatabase();
  private readonly reserveSvc = new ReserveVerificationService();

  async verifyBridge(bridgeId: string, forceRefresh = false): Promise<CrossChainStateResult> {
    const cacheKey = `${CACHE_KEY_PREFIX}${bridgeId}`;

    if (!forceRefresh) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as CrossChainStateResult;
        const ageSecs = Math.floor(
          (Date.now() - new Date(result.verifiedAt).getTime()) / 1000
        );
        return { ...result, cacheHit: true, freshnessSeconds: ageSecs };
      }
    }

    const operator = await this.db("bridge_operators")
      .where({ bridge_id: bridgeId, is_active: true })
      .select(
        "bridge_id",
        "asset_code",
        "contract_address",
        "source_chain",
        "provider_name"
      )
      .first();

    if (!operator) {
      throw new Error(`No active bridge operator found for bridge: ${bridgeId}`);
    }

    // Look up the issuer from the assets table
    const assetRow = await this.db("assets")
      .where({ symbol: operator.asset_code })
      .select("issuer")
      .first()
      .catch(() => null);

    const issuer: string = assetRow?.issuer ?? "";

    const bridge = await this.db("bridges")
      .where({ name: bridgeId })
      .select("name")
      .first()
      .catch(() => null);

    const bridgeName = bridge?.name ?? operator.provider_name ?? bridgeId;
    const now = new Date().toISOString();

    let ethereum: EthereumChainState | null = null;
    let stellar: StellarChainState = { supply: 0, assetCode: operator.asset_code, issuer };
    let merkleProofValid: boolean | null = null;
    let latestCommitmentSequence: number | null = null;
    let status: VerificationStatus = "pending";
    let errorMsg: string | undefined;

    try {
      // Fetch Stellar supply
      if (issuer) {
        const supply = await getStellarAssetSupply(operator.asset_code, issuer);
        stellar = { supply, assetCode: operator.asset_code, issuer };
      }

      // Fetch Ethereum state if contract address is configured
      if (operator.contract_address && operator.source_chain) {
        const ethClient = getEthereumRpcClient();
        const chainId = operator.source_chain as ChainId;

        // Use the token address stored in DB if available; fall back to a lookup
        const tokenRow = await this.db("bridge_assets")
          .where({ bridge_id: bridgeId, asset_code: operator.asset_code })
          .select("token_address")
          .first()
          .catch(() => null);

        const tokenAddress = tokenRow?.token_address ?? operator.contract_address;

        const reserves = await ethClient.getBridgeReserves(
          chainId,
          operator.contract_address,
          tokenAddress
        );

        ethereum = {
          blockNumber: reserves.blockNumber,
          lockedAmount: reserves.lockedAmount.toString(),
          formattedAmount: reserves.formattedAmount,
          isPaused: reserves.isPaused,
          timestamp: reserves.timestamp,
        };
      }

      // Check latest Merkle reserve commitment from Soroban
      const commitment = await this.reserveSvc.getLatestCommitment(bridgeId);
      if (commitment) {
        latestCommitmentSequence = commitment.sequence;
        merkleProofValid = commitment.status === "verified";
      }

      // Compute consistency between Stellar supply and Ethereum locked amount
      const { stateConsistent, mismatchPct } = this.computeConsistency(stellar, ethereum);

      status = !stateConsistent ? "mismatch" : merkleProofValid === false ? "mismatch" : "verified";

      const result: CrossChainStateResult = {
        bridgeId,
        bridgeName,
        sourceChain: operator.source_chain ?? "unknown",
        verifiedAt: now,
        ethereum,
        stellar,
        merkleProofValid,
        latestCommitmentSequence,
        stateConsistent,
        mismatchPct,
        mismatchThreshold: MISMATCH_THRESHOLD_PCT,
        status,
        cacheHit: false,
        freshnessSeconds: 0,
      };

      await redis.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
      await this.persistResult(result);

      if (!stateConsistent) {
        await this.raiseStateAlert(result);
      }

      return result;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ bridgeId, error: errorMsg }, "Cross-chain state verification failed");

      const result: CrossChainStateResult = {
        bridgeId,
        bridgeName,
        sourceChain: operator.source_chain ?? "unknown",
        verifiedAt: now,
        ethereum,
        stellar,
        merkleProofValid,
        latestCommitmentSequence,
        stateConsistent: false,
        mismatchPct: 0,
        mismatchThreshold: MISMATCH_THRESHOLD_PCT,
        status: "error",
        cacheHit: false,
        freshnessSeconds: 0,
        error: errorMsg,
      };

      await redis.set(cacheKey, JSON.stringify(result), "EX", 60); // short TTL on error
      return result;
    }
  }

  async verifyAllBridges(forceRefresh = false): Promise<CrossChainStateResult[]> {
    const operators = await this.db("bridge_operators")
      .where({ is_active: true })
      .select("bridge_id")
      .distinct("bridge_id");

    const results = await Promise.allSettled(
      operators.map((op: { bridge_id: string }) => this.verifyBridge(op.bridge_id, forceRefresh))
    );

    return results
      .filter((r): r is PromiseFulfilledResult<CrossChainStateResult> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  async verifyMerkleProof(req: ProofVerificationRequest): Promise<boolean> {
    const isValid = await this.reserveSvc.verifyProofOnChain(req.bridgeId, req.sequence, req.proof);
    logger.info({ bridgeId: req.bridgeId, sequence: req.sequence, isValid }, "On-chain Merkle proof verified");
    return isValid;
  }

  async getVerificationHistory(bridgeId: string, limit = 20): Promise<CrossChainStateResult[]> {
    const rows = await this.db("cross_chain_verification_log")
      .where({ bridge_id: bridgeId })
      .orderBy("verified_at", "desc")
      .limit(limit)
      .select("*")
      .catch(() => []);

    return rows.map((r: Record<string, unknown>) => ({
      ...(JSON.parse(r.payload as string) as CrossChainStateResult),
      verifiedAt: (r.verified_at as Date).toISOString(),
    }));
  }

  private computeConsistency(
    stellar: StellarChainState,
    ethereum: EthereumChainState | null
  ): { stateConsistent: boolean; mismatchPct: number } {
    if (!ethereum) {
      return { stateConsistent: true, mismatchPct: 0 };
    }

    const ethAmount = parseFloat(ethereum.formattedAmount);
    const stellarSupply = stellar.supply;

    if (ethAmount === 0 && stellarSupply === 0) {
      return { stateConsistent: true, mismatchPct: 0 };
    }

    const denominator = Math.max(ethAmount, stellarSupply);
    const mismatchPct = (Math.abs(ethAmount - stellarSupply) / denominator) * 100;
    const stateConsistent = mismatchPct <= MISMATCH_THRESHOLD_PCT;

    return { stateConsistent, mismatchPct };
  }

  private async persistResult(result: CrossChainStateResult): Promise<void> {
    await this.db("cross_chain_verification_log")
      .insert({
        bridge_id: result.bridgeId,
        status: result.status,
        mismatch_pct: result.mismatchPct,
        state_consistent: result.stateConsistent,
        merkle_proof_valid: result.merkleProofValid,
        verified_at: new Date(result.verifiedAt),
        payload: JSON.stringify(result),
      })
      .catch((err: Error) => {
        // Table may not exist in all envs; log and continue
        logger.warn({ err: err.message }, "Could not persist cross-chain verification log");
      });
  }

  private async raiseStateAlert(result: CrossChainStateResult): Promise<void> {
    // Use a sentinel rule_id to distinguish system-generated alerts (no FK enforced on hypertable)
    const SYSTEM_RULE_ID = "00000000-0000-0000-0000-000000000000";

    await this.db("alert_events")
      .insert({
        rule_id: SYSTEM_RULE_ID,
        asset_code: result.stellar.assetCode,
        alert_type: "supply_mismatch",
        priority: result.mismatchPct >= 10 ? "critical" : "high",
        triggered_value: result.mismatchPct,
        threshold: MISMATCH_THRESHOLD_PCT,
        metric: "cross_chain_state_mismatch",
        webhook_delivered: false,
        webhook_attempts: 0,
      })
      .catch((err: Error) => {
        logger.warn({ err: err.message }, "Could not persist state mismatch alert");
      });

    logger.warn(
      {
        bridgeId: result.bridgeId,
        mismatchPct: result.mismatchPct,
        stellarSupply: result.stellar.supply,
        ethLocked: result.ethereum?.formattedAmount,
      },
      "Cross-chain state mismatch detected"
    );
  }
}

let _instance: CrossChainStateVerificationService | null = null;

export function getCrossChainVerificationService(): CrossChainStateVerificationService {
  if (!_instance) _instance = new CrossChainStateVerificationService();
  return _instance;
}
