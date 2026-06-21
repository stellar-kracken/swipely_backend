import { RiskFactors, RiskScoreResult, RiskLevel } from "./risk.types.js";
import { RISK_WEIGHTS, getRiskLevel } from "./risk.constants.js";

export class RiskScoringService {
  public computeScore(bridgeId: string, factors: Partial<RiskFactors>): RiskScoreResult {
    // Handle missing factors by defaulting to a neutral/safe score or 0
    const safeFactors: RiskFactors = {
      reserveBacking: factors.reserveBacking ?? 50,
      operatorReputation: factors.operatorReputation ?? 50,
      transactionHistory: factors.transactionHistory ?? 50,
      anomalyFrequency: factors.anomalyFrequency ?? 50,
      resolutionTime: factors.resolutionTime ?? 50,
    };

    const riskScore = 
      (safeFactors.reserveBacking * RISK_WEIGHTS.reserveBacking) +
      (safeFactors.operatorReputation * RISK_WEIGHTS.operatorReputation) +
      (safeFactors.transactionHistory * RISK_WEIGHTS.transactionHistory) +
      (safeFactors.anomalyFrequency * RISK_WEIGHTS.anomalyFrequency) +
      (safeFactors.resolutionTime * RISK_WEIGHTS.resolutionTime);

    // Normalize to 0-100 just in case
    const normalizedScore = Math.max(0, Math.min(100, Math.round(riskScore)));

    return {
      bridgeId,
      riskScore: normalizedScore,
      level: getRiskLevel(normalizedScore),
      factors: safeFactors,
    };
  }
}

export const riskScoringService = new RiskScoringService();
