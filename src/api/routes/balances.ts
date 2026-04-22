import type { FastifyInstance } from "fastify";
import { BalanceService } from "../../services/balance.service.js";

export async function balanceRoutes(server: FastifyInstance) {
  const balanceService = new BalanceService();

  server.get<{ Querystring: { asset?: string } }>(
    "/",
    {
      schema: {
        tags: ["Balances"],
        summary: "List tracked balances",
      },
    },
    async (request) => {
      const balances = await balanceService.listBalances(request.query.asset);
      return { balances };
    },
  );

  server.post<{
    Body: { significantChangeThresholdPct?: number };
  }>(
    "/sync",
    {
      schema: {
        tags: ["Balances"],
        summary: "Sync tracked balances across configured chains",
      },
    },
    async (request) => {
      const result = await balanceService.syncTrackedBalances(undefined, request.body ?? {});
      return { success: true, ...result };
    },
  );

  server.post(
    "/stream/start",
    {
      schema: {
        tags: ["Balances"],
        summary: "Start real-time balance tracking for Stellar accounts",
      },
    },
    async () => {
      await balanceService.startRealTimeTracking();
      return { success: true };
    },
  );

  server.post(
    "/stream/stop",
    {
      schema: {
        tags: ["Balances"],
        summary: "Stop real-time balance tracking",
      },
    },
    async () => {
      await balanceService.stopRealTimeTracking();
      return { success: true };
    },
  );

  server.get<{ Params: { assetCode: string }; Querystring: { limit?: string } }>(
    "/history/:assetCode",
    {
      schema: {
        tags: ["Balances"],
        summary: "Get balance history for an asset",
      },
    },
    async (request) => {
      const history = await balanceService.getBalanceHistory(
        request.params.assetCode,
        Number(request.query.limit ?? "100"),
      );
      return { history };
    },
  );

  server.get<{ Params: { assetCode: string } }>(
    "/compare/:assetCode",
    {
      schema: {
        tags: ["Balances"],
        summary: "Compare tracked balances across chains",
      },
    },
    async (request) => {
      return balanceService.getCrossChainComparison(request.params.assetCode);
    },
  );

  server.get<{ Params: { assetCode: string } }>(
    "/reconcile/:assetCode",
    {
      schema: {
        tags: ["Balances"],
        summary: "Reconcile issuer, reserve, and custody balances",
      },
    },
    async (request) => {
      return balanceService.reconcileBalances(request.params.assetCode);
    },
  );
}
