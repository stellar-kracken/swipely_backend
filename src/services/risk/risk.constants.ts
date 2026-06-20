export const RISK_WEIGHTS = {
  reserveBacking: 0.35,
  operatorReputation: 0.20,
  transactionHistory: 0.15,
  anomalyFrequency: 0.20,
  resolutionTime: 0.10,
};

export function getRiskLevel(score: number): "LOW" | "MODERATE" | "HIGH" | "CRITICAL" {
  if (score <= 25) return "LOW";
  if (score <= 50) return "MODERATE";
  if (score <= 75) return "HIGH";
  return "CRITICAL";
}
