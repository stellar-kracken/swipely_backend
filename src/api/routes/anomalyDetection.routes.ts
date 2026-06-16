import type { FastifyInstance } from "fastify";
import { anomalyDetectionService } from "../../services/anomalyDetection.service.js";
import type { AnomalySeverity } from "../../database/models/anomaly.model.js";

export async function anomalyDetectionRoutes(server: FastifyInstance) {
  server.get<{
    Querystring: {
      assetCode?: string;
      bridgeName?: string;
      severity?: AnomalySeverity;
      includeSuppressed?: string;
      limit?: string;
    };
  }>(
    "/events",
    {
      schema: {
        tags: ["Anomaly Detection"],
        summary: "List recent anomaly detections",
        querystring: {
          type: "object",
          properties: {
            assetCode: { type: "string" },
            bridgeName: { type: "string" },
            severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
            includeSuppressed: { type: "string", enum: ["true", "false"] },
            limit: { type: "string" },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request) => {
      const events = await anomalyDetectionService.getRecentEvents({
        assetCode: request.query.assetCode,
        bridgeName: request.query.bridgeName,
        severity: request.query.severity,
        includeSuppressed: request.query.includeSuppressed === "true",
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      });

      return { events, count: events.length };
    }
  );

  server.post<{
    Body: { assetCode: string; bridgeName?: string };
  }>(
    "/evaluate",
    {
      schema: {
        tags: ["Anomaly Detection"],
        summary: "Run anomaly detection for a single asset",
        body: {
          type: "object",
          required: ["assetCode"],
          properties: {
            assetCode: { type: "string" },
            bridgeName: { type: "string" },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request) => anomalyDetectionService.evaluateAsset(request.body.assetCode, request.body.bridgeName)
  );

  server.get(
    "/thresholds",
    {
      schema: {
        tags: ["Anomaly Detection"],
        summary: "List anomaly detection thresholds",
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async () => {
      const thresholds = await anomalyDetectionService.getThresholds();
      return { thresholds, count: thresholds.length };
    }
  );

  server.put<{
    Body: {
      assetCode?: string;
      bridgeName?: string;
      priceChangePct: number;
      liquidityChangePct: number;
      supplyMismatchPct: number;
      healthScoreDrop: number;
      minSignalCount: number;
      duplicateWindowSeconds: number;
      isActive?: boolean;
    };
  }>(
    "/thresholds",
    {
      schema: {
        tags: ["Anomaly Detection"],
        summary: "Create or update anomaly detection thresholds",
        body: {
          type: "object",
          required: [
            "priceChangePct",
            "liquidityChangePct",
            "supplyMismatchPct",
            "healthScoreDrop",
            "minSignalCount",
            "duplicateWindowSeconds",
          ],
          properties: {
            assetCode: { type: "string", default: "*" },
            bridgeName: { type: "string", default: "*" },
            priceChangePct: { type: "number", minimum: 0 },
            liquidityChangePct: { type: "number", minimum: 0 },
            supplyMismatchPct: { type: "number", minimum: 0 },
            healthScoreDrop: { type: "number", minimum: 0 },
            minSignalCount: { type: "integer", minimum: 1 },
            duplicateWindowSeconds: { type: "integer", minimum: 1 },
            isActive: { type: "boolean", default: true },
          },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request) => {
      const body = request.body;
      const threshold = await anomalyDetectionService.upsertThreshold({
        asset_code: body.assetCode ?? "*",
        bridge_name: body.bridgeName ?? "*",
        price_change_pct: body.priceChangePct,
        liquidity_change_pct: body.liquidityChangePct,
        supply_mismatch_pct: body.supplyMismatchPct,
        health_score_drop: body.healthScoreDrop,
        min_signal_count: body.minSignalCount,
        duplicate_window_seconds: body.duplicateWindowSeconds,
        is_active: body.isActive ?? true,
      });

      return { threshold };
    }
  );
}
