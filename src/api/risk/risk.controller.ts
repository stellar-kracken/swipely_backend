import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { riskScoringService } from "../../services/risk/risk-scoring.service.js";
import { riskHistoryService } from "../../services/risk/risk-history.service.js";
import { BridgeIdParam } from "./risk.dto.js";

export function riskController(fastify: FastifyInstance, opts: any, done: () => void) {
  fastify.get("/:bridgeId", async (request: FastifyRequest<{ Params: BridgeIdParam }>, reply: FastifyReply) => {
    try {
      const { bridgeId } = request.params;
      
      // Simulating fetching latest factors for the bridge
      const factors = {
        reserveBacking: 85,
        operatorReputation: 70,
        transactionHistory: 72,
        anomalyFrequency: 45,
        resolutionTime: 55,
      };

      const scoreResult = riskScoringService.computeScore(bridgeId, factors);
      await riskHistoryService.saveScore(scoreResult);

      return reply.send(scoreResult);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Failed to compute risk score" });
    }
  });

  fastify.get("/:bridgeId/history", async (request: FastifyRequest<{ Params: BridgeIdParam }>, reply: FastifyReply) => {
    try {
      const { bridgeId } = request.params;
      const history = await riskHistoryService.getHistory(bridgeId);
      return reply.send({ bridgeId, history });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Failed to fetch risk history" });
    }
  });

  fastify.get("/:bridgeId/volatility", async (request: FastifyRequest<{ Params: BridgeIdParam }>, reply: FastifyReply) => {
    try {
      const { bridgeId } = request.params;
      const volatility = await riskHistoryService.getVolatility(bridgeId);
      return reply.send({ bridgeId, ...volatility });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Failed to fetch risk volatility" });
    }
  });

  done();
}
