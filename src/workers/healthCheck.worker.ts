import { Worker, Queue } from "bullmq";
import { config } from "../config/index.js";
import { HealthService } from "../services/health.service.js";
import { logger } from "../utils/logger.js";
import { alertRoutingService, type RouteableAlert } from "../services/alertRouting.service.js";
import { duplicateAlertCheckService } from "../services/duplicateAlertCheck.service.js";
import type { AlertEvent } from "../services/alert.service.js";
import { HealthScoreModel } from "../database/models/healthScore.model.js";

const QUEUE_NAME = "health-check";

const healthScoreModel = new HealthScoreModel();

const connection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
};

export const healthCheckQueue = new Queue(QUEUE_NAME, { connection });

import type { HealthScore } from "../services/health.service.js";

function buildDeterioratingAlert(score: HealthScore): RouteableAlert {
  return {
    eventTime: new Date(),
    alertRuleId: `health-check-${score.symbol}`,
    ownerAddress: "system",
    ruleName: "Health Score Deteriorating",
    assetCode: score.symbol,
    sourceType: "health_deterioration",
    severity: score.overallScore < 0.3 ? "critical" : "high",
    triggeredValue: score.overallScore,
    threshold: config.HEALTH_SCORE_THRESHOLD ?? 0.5,
    metric: "overall_health_score",
  };
}

async function persistHealthScores(scores: HealthScore[]): Promise<void> {
  const now = new Date();
  for (const score of scores) {
    try {
      await healthScoreModel.insert({
        time: now,
        symbol: score.symbol,
        overall_score: score.overallScore,
        liquidity_depth_score: score.factors.liquidityDepth,
        price_stability_score: score.factors.priceStability,
        bridge_uptime_score: score.factors.bridgeUptime,
        reserve_backing_score: score.factors.reserveBacking,
        volume_trend_score: score.factors.volumeTrend,
      });
    } catch (err) {
      logger.error({ err, symbol: score.symbol }, "Failed to persist health score");
    }
  }
}

/**
 * Worker that periodically computes composite health scores for all
 * monitored assets and persists them for trending analysis.
 */
export const healthCheckWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const healthService = new HealthService();
    logger.info({ jobId: job.id }, "Processing health check job");

    try {
      const scores = await healthService.computeAllHealthScores();

      // TODO: Persist health scores to TimescaleDB
      // TODO: Detect deteriorating trends and trigger alerts

      logger.info(
        { assetCount: scores.length },
        "Health check completed for all assets"
      );

      return { success: true, scores };
    } catch (error) {
      logger.error({ error }, "Health check job failed");
      throw error;
    }
  },
  { connection, concurrency: 1 }
);

healthCheckWorker.on("completed", (job) => {
  logger.debug({ jobId: job?.id }, "Health check job completed");
});

healthCheckWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "Health check job failed");
});
