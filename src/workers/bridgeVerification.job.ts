import { Job } from "bullmq";
import { BridgeService } from "../services/bridge.service.js";
import { SUPPORTED_ASSETS } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

const bridgeService = new BridgeService();

export async function processBridgeVerification(job: Job) {
  logger.info({ jobId: job.id }, "Starting bridge verification job");
  
  // Phase 1 assets that apply to the cross-chain bridge verification
  const bridgedAssets = SUPPORTED_ASSETS.filter(a => ["USDC", "EURC"].includes(a.code));
  
  for (const asset of bridgedAssets) {
    try {
      const result = await bridgeService.verifySupply(asset.code);
      if (result.isFlagged) {
        logger.error(
          { asset: asset.code, result }, 
          `CRITICAL: Bridge supply mismatch exceeds threshold of ${config.BRIDGE_SUPPLY_MISMATCH_THRESHOLD}%`
        );
      } else if (result.errorStatus) {
        logger.warn(
          { asset: asset.code, error: result.errorStatus },
          "Bridge verification skipped or failed due to fetch error."
        );
      } else {
        logger.info(
          { asset: asset.code, mismatch: result.mismatchPercentage },
          "Bridge reserve verification completed successfully."
        );
      }
    } catch (error) {
      logger.error({ error, asset: asset.code }, "Unexpected failure during bridge verification job");
    }
  }
}
