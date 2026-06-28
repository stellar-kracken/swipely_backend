import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsageMetricsService, getUsageMetricsService } from "../../src/services/usageMetrics.service.js";

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock database
const mockInsert = vi.fn().mockResolvedValue([1]);
const mockRaw = vi.fn().mockResolvedValue({
  rows: [
    { period: "2026-06-28T00:00:00.000Z", key: "/api/test", count: "5", avg_ms: "120.5", p95_ms: "200.0" }
  ]
});

const mockDb = vi.fn().mockReturnValue({
  insert: mockInsert,
});
// Attach raw to the mockDb function object
mockDb.raw = mockRaw;

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockDb,
}));

describe("UsageMetricsService", () => {
  let service: UsageMetricsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = getUsageMetricsService();
  });

  it("should record a usage metric without blocking", async () => {
    // Calling the function which does fire-and-forget
    await service.record({
      endpoint: "/api/test",
      method: "GET",
      status_code: 200,
      duration_ms: 150,
      user_id: "user-123",
      metadata: { region: "us-east" }
    });
    
    // Give the event loop a tick to process the unawaited Promise
    await new Promise(resolve => setImmediate(resolve));

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith({
      endpoint: "/api/test",
      method: "GET",
      status_code: 200,
      duration_ms: 150,
      user_id: "user-123",
      metadata: JSON.stringify({ region: "us-east" }),
    });
  });

  it("should record a usage metric with defaults", async () => {
    await service.record({
      endpoint: "/api/health",
      method: "GET",
      status_code: 200,
      duration_ms: 10,
    });
    
    await new Promise(resolve => setImmediate(resolve));

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "/api/health",
      method: "GET",
      status_code: 200,
      duration_ms: 10,
      user_id: null,
      metadata: "{}",
    }));
  });

  it("should handle recording errors gracefully", async () => {
    const { logger } = await import("../../src/utils/logger.js");
    mockInsert.mockRejectedValueOnce(new Error("DB Error"));

    await service.record({
      endpoint: "/api/error",
      method: "POST",
      status_code: 500,
      duration_ms: 500,
    });
    
    await new Promise(resolve => setImmediate(resolve));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to record usage metric"
    );
  });

  it("should query aggregates with default parameters", async () => {
    const result = await service.queryAggregates({});

    expect(mockRaw).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe("5");
    
    const queryStr = mockRaw.mock.calls[0][0];
    expect(queryStr).toContain("date_trunc('hour', created_at)");
    expect(queryStr).toContain("endpoint as key");
  });

  it("should query aggregates with custom parameters", async () => {
    const start = new Date("2026-06-20T00:00:00Z").toISOString();
    const end = new Date("2026-06-21T00:00:00Z").toISOString();

    const result = await service.queryAggregates({
      start,
      end,
      groupBy: "method",
      rollup: "day"
    });

    expect(mockRaw).toHaveBeenCalledTimes(1);
    const args = mockRaw.mock.calls[0];
    const queryStr = args[0];
    const params = args[1];

    expect(queryStr).toContain("date_trunc('day', created_at)");
    expect(queryStr).toContain("method as key");
    expect(params).toEqual([start, end]);
    
    expect(result).toHaveLength(1);
  });
});
