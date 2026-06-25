import { describe, it, expect, beforeEach, vi } from "vitest";
import { MetricsAggregationService } from "../../src/services/metricsAggregation.service.js";

const createQueryBuilder = (rows: any[] = []) => {
  const builder: any = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    delete: vi.fn().mockResolvedValue(rows.length),
    onConflict: vi.fn().mockReturnThis(),
    merge: vi.fn().mockResolvedValue(rows),
    ignore: vi.fn().mockResolvedValue(rows),
    returning: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: any) => any) => resolve(rows),
  };
  return builder;
};

const mockKnex = vi.hoisted(() => {
  const knex: any = vi.fn(() => createQueryBuilder([]));
  knex.raw = vi.fn().mockResolvedValue({ rows: [] });
  return knex;
});

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockKnex,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("MetricsAggregationService", () => {
  let service: MetricsAggregationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKnex.raw.mockResolvedValue({ rows: [] });
    service = new MetricsAggregationService();
  });

  describe("ingest", () => {
    it("inserts raw data points and returns the count", async () => {
      mockKnex.mockImplementation(() => createQueryBuilder([]));

      const count = await service.ingest([
        { metricKey: "bridge.latency_ms", value: 120 },
        { metricKey: "bridge.latency_ms", value: 95 },
      ]);

      expect(count).toBe(2);
      expect(mockKnex).toHaveBeenCalledWith("metric_data_points");
    });

    it("returns 0 without touching the database when no points are given", async () => {
      const count = await service.ingest([]);
      expect(count).toBe(0);
      expect(mockKnex).not.toHaveBeenCalled();
    });

    it("rejects batches larger than the configured maximum", async () => {
      const points = Array.from({ length: 1001 }, (_, i) => ({ metricKey: "x", value: i }));
      await expect(service.ingest(points)).rejects.toThrow(/Cannot ingest more than/);
    });
  });

  describe("runRollup", () => {
    it("aggregates hourly windows from raw points and upserts rollups", async () => {
      mockKnex.raw.mockResolvedValue({
        rows: [
          {
            metricKey: "bridge.latency_ms",
            windowStart: "2024-01-01T00:00:00Z",
            windowEnd: "2024-01-01T01:00:00Z",
            sampleCount: 10,
            sumValue: 1000,
            minValue: 50,
            maxValue: 200,
            avgValue: 100,
            p50Value: 95,
            p95Value: 180,
            p99Value: 195,
          },
        ],
      });
      const builder = createQueryBuilder([]);
      mockKnex.mockImplementation(() => builder);

      const windows = await service.runRollup("hourly");

      expect(windows).toBe(1);
      expect(mockKnex.raw).toHaveBeenCalledTimes(1);
      expect(builder.onConflict).toHaveBeenCalledWith(["metric_key", "granularity", "window_start"]);
    });

    it("returns 0 when there are no complete windows to roll up", async () => {
      mockKnex.raw.mockResolvedValue({ rows: [] });
      const windows = await service.runRollup("daily");
      expect(windows).toBe(0);
    });
  });

  describe("getRollups", () => {
    it("filters by metric key and time range", async () => {
      const rows = [
        {
          id: "r1",
          metric_key: "bridge.latency_ms",
          granularity: "hourly",
          window_start: "2024-01-01T00:00:00Z",
          window_end: "2024-01-01T01:00:00Z",
          sample_count: 5,
          sum_value: 500,
          min_value: 50,
          max_value: 150,
          avg_value: 100,
          p50_value: 95,
          p95_value: 140,
          p99_value: 148,
          tags: "{}",
          created_at: "2024-01-01T01:00:00Z",
        },
      ];
      const builder = createQueryBuilder(rows);
      mockKnex.mockImplementation(() => builder);

      const result = await service.getRollups({ metricKey: "bridge.latency_ms", granularity: "hourly" });

      expect(result).toHaveLength(1);
      expect(result[0].metricKey).toBe("bridge.latency_ms");
      expect(builder.where).toHaveBeenCalledWith("granularity", "hourly");
    });
  });

  describe("exportRollups", () => {
    it("exports rollups as CSV with a header row", async () => {
      const rows = [
        {
          id: "r1",
          metric_key: "bridge.latency_ms",
          granularity: "hourly",
          window_start: "2024-01-01T00:00:00Z",
          window_end: "2024-01-01T01:00:00Z",
          sample_count: 5,
          sum_value: 500,
          min_value: 50,
          max_value: 150,
          avg_value: 100,
          p50_value: 95,
          p95_value: 140,
          p99_value: 148,
          tags: "{}",
          created_at: "2024-01-01T01:00:00Z",
        },
      ];
      mockKnex.mockImplementation(() => createQueryBuilder(rows));

      const csv = await service.exportRollups({ granularity: "hourly" }, "csv");

      expect(csv.split("\n")[0]).toContain("metricKey");
      expect(csv).toContain("bridge.latency_ms");
    });

    it("exports rollups as JSON", async () => {
      mockKnex.mockImplementation(() => createQueryBuilder([]));
      const json = await service.exportRollups({ granularity: "daily" }, "json");
      expect(JSON.parse(json)).toEqual([]);
    });
  });

  describe("retention policies", () => {
    it("rejects non-positive retention windows", async () => {
      await expect(service.setRetentionPolicy("hourly", 0)).rejects.toThrow(/positive integer/);
    });

    it("applies retention by deleting rows older than the cutoff per granularity", async () => {
      const policyRows = [
        { granularity: "raw", retention_days: 7, updated_at: "2024-01-01T00:00:00Z" },
        { granularity: "hourly", retention_days: 90, updated_at: "2024-01-01T00:00:00Z" },
      ];
      const deleteBuilder = createQueryBuilder([]);
      deleteBuilder.delete = vi.fn().mockResolvedValue(3);

      mockKnex.mockImplementation((table: string) => {
        if (table === "metric_retention_policies") return createQueryBuilder(policyRows);
        return deleteBuilder;
      });

      const deleted = await service.applyRetentionPolicies();

      expect(deleted.raw).toBe(3);
      expect(deleted.hourly).toBe(3);
    });
  });
});
