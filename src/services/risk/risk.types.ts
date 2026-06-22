export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface RiskFactors {
  reserveBacking: number;
  operatorReputation: number;
  transactionHistory: number;
  anomalyFrequency: number;
  resolutionTime: number;
}

export interface RiskScoreResult {
  bridgeId: string;
  riskScore: number;
  level: RiskLevel;
  factors: RiskFactors;
}

export interface RiskHistoryEntry {
  id: string;
  bridgeId: string;
  riskScore: number;
  reserveScore: number;
  reputationScore: number;
  volumeScore: number;
  anomalyScore: number;
  resolutionScore: number;
  createdAt: Date;
}
