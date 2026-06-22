import { logger } from "../../utils/logger.js";
import { RiskScoreResult } from "./risk.types.js";

export class RiskAlertService {
  public checkAndAlert(scoreResult: RiskScoreResult) {
    if (scoreResult.riskScore >= 75) {
      logger.error({
        event: "createAlert",
        bridgeId: scoreResult.bridgeId,
        severity: "critical",
        type: "bridge-risk-escalation",
        score: scoreResult.riskScore
      }, "Bridge Risk Escalation Alert Triggered!");
    }
  }
}

export const riskAlertService = new RiskAlertService();
