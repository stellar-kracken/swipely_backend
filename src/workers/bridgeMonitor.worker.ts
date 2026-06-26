import { Worker, Queue } from "bullmq";
import { config } from "../config/index.js";
import { BridgeService } from "../services/bridge.service.js";
import { logger } from "../utils/logger.js";
import { alertRoutingService, type RouteableAlert } from "../services/alertRouting.service.js";
import { duplicateAlertCheckService } from "../services/duplicateAlertCheck.service.js";
import type { AlertEvent } from "../services/alert.service.js";
import { getDatabase } from "../database/connection.js";

const QUEUE_NAME = "bridge-monitor";

const connection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
};

export const bridgeMonitorQueue = new Queue(QUEUE_NAME, { connection });

async function persistMonitorResult(
  assetCode: string,
  supplyCheck: { match: boolean; mismatchPercentage?: number; stellarSupply?: number; evmSupply?: number }
): Promise<void> {
  try {
    const db = getDatabase();
    await db("bridge_monitor_results").insert({
      time: new Date(),
      asset_code: assetCode,
      supply_match: supplyCheck.match,
      mismatch_pct: supplyCheck.mismatchPercentage ?? 0,
      stellar_supply: supplyCheck.stellarSupply ?? null,
      evm_supply: supplyCheck.evmSupply ?? null,
    });
  } catch (err) {
    logger.error({ err, assetCode }, "Failed to persist bridge monitor result");
  }
}

function buildMismatchAlert(assetCode: string, supplyCheck: { mismatchPercentage?: number }): RouteableAlert {
  return {
    eventTime: new Date(),
    alertRuleId: `bridge-monitor-${assetCode}`,
    ownerAddress: "system",
    ruleName: "Bridge Supply Mismatch",
    assetCode,
    sourceType: "supply_mismatch",
    severity: "high",
    triggeredValue: supplyCheck.mismatchPercentage ?? 0,
    threshold: config.BRIDGE_MISMATCH_THRESHOLD ?? 0.01,
    metric: "supply_mismatch_pct",
  };
}

/**
 * Worker that continuously monitors bridge integrity:
 * - Tracks mint/burn events on Stellar
 * - Verifies supply consistency across chains
 * - Detects supply mismatches above the configured threshold
 * - Records bridge performance and uptime
 */
export const bridgeMonitorWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const bridgeService = new BridgeService();
    logger.info({ jobId: job.id, data: job.data }, "Processing bridge monitor job");

    const { assetCode } = job.data;

    try {
      // Verify supply consistency
      const supplyCheck = await bridgeService.verifySupply(assetCode);

      if (!supplyCheck.match) {
        logger.warn({ ...supplyCheck }, "Bridge supply mismatch detected");

        const dedupEvent: Omit<AlertEvent, "eventId"> = {
          ruleId: `bridge-monitor-${assetCode}`,
          assetCode,
          alertType: "supply_mismatch",
          priority: "high",
          triggeredValue: supplyCheck.mismatchPercentage ?? 0,
          threshold: config.BRIDGE_MISMATCH_THRESHOLD ?? 0.01,
          metric: "supply_mismatch_pct",
          webhookDelivered: false,
          onChainEventId: null,
        };

        const dedupResult = duplicateAlertCheckService.check(dedupEvent);

        if (!dedupResult.isDuplicate || dedupResult.action !== "block") {
          const alert = buildMismatchAlert(assetCode, supplyCheck);
          await alertRoutingService.routeAlert(alert);
          logger.info({ assetCode }, "Supply mismatch alert routed");
        } else {
          logger.debug({ assetCode, reason: dedupResult.reason }, "Mismatch alert suppressed by deduplication");
        }
      }

      await persistMonitorResult(assetCode, supplyCheck);
      return { success: true, assetCode, supplyCheck };
    } catch (error) {
      logger.error({ error, assetCode }, "Bridge monitor job failed");
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

bridgeMonitorWorker.on("completed", (job) => {
  logger.debug({ jobId: job?.id }, "Bridge monitor job completed");
});

bridgeMonitorWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "Bridge monitor job failed");
});
