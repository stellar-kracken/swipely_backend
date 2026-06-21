import { getDatabase } from "../../database/connection.js";
import { RiskScoreResult, RiskHistoryEntry } from "./risk.types.js";
import { riskAlertService } from "./risk-alert.service.js";

export class RiskHistoryService {
  public async saveScore(result: RiskScoreResult): Promise<void> {
    const db = getDatabase();
    await db("bridge_risk_history").insert({
      bridge_id: result.bridgeId,
      risk_score: result.riskScore,
      reserve_score: result.factors.reserveBacking,
      reputation_score: result.factors.operatorReputation,
      volume_score: result.factors.transactionHistory,
      anomaly_score: result.factors.anomalyFrequency,
      resolution_score: result.factors.resolutionTime,
    });
    
    riskAlertService.checkAndAlert(result);
  }

  public async getHistory(bridgeId: string, limit: number = 30): Promise<RiskHistoryEntry[]> {
    const db = getDatabase();
    const rows = await db("bridge_risk_history")
      .where("bridge_id", bridgeId)
      .orderBy("created_at", "desc")
      .limit(limit);

    return rows.map(r => ({
      id: r.id,
      bridgeId: r.bridge_id,
      riskScore: parseFloat(r.risk_score),
      reserveScore: parseFloat(r.reserve_score),
      reputationScore: parseFloat(r.reputation_score),
      volumeScore: parseFloat(r.volume_score),
      anomalyScore: parseFloat(r.anomaly_score),
      resolutionScore: parseFloat(r.resolution_score),
      createdAt: r.created_at
    }));
  }

  public async getVolatility(bridgeId: string): Promise<{ volatility: number }> {
    const history = await this.getHistory(bridgeId, 30);
    if (history.length < 2) return { volatility: 0 };

    const scores = history.map(h => h.riskScore);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
    
    return { volatility: parseFloat(Math.sqrt(variance).toFixed(2)) };
  }
}

export const riskHistoryService = new RiskHistoryService();
