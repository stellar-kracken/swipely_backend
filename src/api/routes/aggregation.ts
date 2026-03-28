import type { FastifyInstance } from "fastify";
import {
  aggregationService,
  AggregationInterval,
} from "../../services/aggregation.service";

export async function aggregationRoutes(server: FastifyInstance) {
  // Aggregate price data
  server.get<{
    Params: { symbol: string };
    Querystring: {
      interval: AggregationInterval;
      startTime: string;
      endTime: string;
    };
  }>("/:symbol/prices", async (request, _reply) => {
    const { symbol } = request.params;
    const { interval, startTime, endTime } = request.query;

    const start = new Date(startTime);
    const end = new Date(endTime);

    const aggregations = await aggregationService.aggregatePrices(
      symbol,
      interval,
      start,
      end,
    );

    return { symbol, interval, aggregations, total: aggregations.length };
  });

  // Aggregate health scores
  server.get<{
    Params: { symbol: string };
    Querystring: {
      interval: AggregationInterval;
      startTime: string;
      endTime: string;
    };
  }>("/:symbol/health", async (request, _reply) => {
    const { symbol } = request.params;
    const { interval, startTime, endTime } = request.query;

    const start = new Date(startTime);
    const end = new Date(endTime);

    const aggregations = await aggregationService.aggregateHealthScores(
      symbol,
      interval,
      start,
      end,
    );

    return { symbol, interval, aggregations, total: aggregations.length };
  });

  // Aggregate volume data
  server.get<{
    Params: { symbol: string };
    Querystring: {
      interval: AggregationInterval;
      startTime: string;
      endTime: string;
    };
  }>("/:symbol/volume", async (request, _reply) => {
    const { symbol } = request.params;
    const { interval, startTime, endTime } = request.query;

    const start = new Date(startTime);
    const end = new Date(endTime);

    const aggregations = await aggregationService.aggregateVolume(
      symbol,
      interval,
      start,
      end,
    );

    return { symbol, interval, aggregations, total: aggregations.length };
  });

  // Pre-compute aggregations
  server.post<{
    Body: { interval: AggregationInterval };
  }>("/precompute", async (request, reply) => {
    const { interval } = request.body;

    await aggregationService.preComputeAggregations(interval);

    return reply
      .code(200)
      .send({ message: "Aggregations pre-computed successfully" });
  });

  // Rebuild historical aggregations
  server.post<{
    Body: {
      symbol: string;
      startDate: string;
      endDate: string;
    };
  }>("/rebuild", async (request, reply) => {
    const { symbol, startDate, endDate } = request.body;

    await aggregationService.rebuildHistoricalAggregations(
      symbol,
      new Date(startDate),
      new Date(endDate),
    );

    return reply
      .code(200)
      .send({ message: "Historical aggregations rebuilt successfully" });
  });

  // Get multi-asset aggregation
  server.post<{
    Body: {
      symbols: string[];
      interval: AggregationInterval;
      startTime: string;
      endTime: string;
    };
  }>("/multi-asset", async (request, _reply) => {
    const { symbols, interval, startTime, endTime } = request.body;

    const start = new Date(startTime);
    const end = new Date(endTime);

    const aggregations = await aggregationService.getMultiAssetAggregation(
      symbols,
      interval,
      start,
      end,
    );

    return { aggregations };
  });

  // Cleanup old cache
  server.post<{
    Body: { olderThanDays?: number };
  }>("/cache/cleanup", async (request, reply) => {
    const { olderThanDays } = request.body;

    await aggregationService.cleanupOldCache(olderThanDays);

    return reply
      .code(200)
      .send({ message: "Old cache cleaned up successfully" });
  });

  // Get aggregation statistics
  server.get("/stats", async (_request, _reply) => {
    const stats = await aggregationService.getAggregationStats();
    return stats;
  });
}
