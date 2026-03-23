import { BridgeService } from "../services/bridge.service.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

let verificationInterval: NodeJS.Timeout | null = null;
const bridgeService = new BridgeService();

// Phase 1 assets that apply to the cross-chain bridge verification
const PHASE1_ASSETS = ["USDC", "EURC"];

export async function runBridgeVerification(): Promise<void> {
  logger.info("Starting scheduled bridge supply verification...");
  
  for (const asset of PHASE1_ASSETS) {
    try {
      const result = await bridgeService.verifySupply(asset);
      if (result.isFlagged) {
        logger.error(
          { asset, result }, 
          `CRITICAL: Bridge supply mismatch exceeds threshold of ${config.BRIDGE_SUPPLY_MISMATCH_THRESHOLD}%`
        );
      } else if (result.errorStatus) {
        logger.warn(
          { asset, error: result.errorStatus },
          "Bridge verification skipped or failed due to fetch error."
        );
      } else {
        logger.info(
          { asset, mismatch: result.mismatchPercentage },
          "Bridge reserve verification completed successfully."
        );
      }
    } catch (error) {
       // Deep catch block to ensure a single asset failure doesn't halt the entire job loop
       logger.error({ error, asset }, "Unexpected failure during scheduled verification job");
    }
  }
}

export function startBridgeVerificationJob(): void {
  const intervalMs = config.BRIDGE_VERIFICATION_INTERVAL_MS;
  logger.info({ intervalMs }, "Initializing scheduled bridge verification job");
  
  // Run immediately on start
  runBridgeVerification().catch(err => {
    logger.error({ error: err }, "Initial bridge verification execution failed");
  });
  
  // Set up periodic interval
  verificationInterval = setInterval(() => {
    runBridgeVerification().catch(err => {
        logger.error({ error: err }, "Scheduled bridge verification execution failed");
    });
  }, intervalMs);
}

export function stopBridgeVerificationJob(): void {
  if (verificationInterval) {
    clearInterval(verificationInterval);
    verificationInterval = null;
    logger.info("Stopped scheduled bridge verification job");
  }
}
