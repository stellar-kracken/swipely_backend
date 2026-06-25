import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventReplayService } from "../../src/services/eventReplay.service.js";

const createQueryBuilder = (rows: any[] = []) => {
  const builder: any = {
    whereIn: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
    count: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(rows[0]),
    clone: vi.fn(() => builder),
    then: (resolve: (value: any) => any) => resolve(rows),
  };
  return builder;
};

const mockKnex = vi.hoisted(() => {
  const knex: any = vi.fn(() => createQueryBuilder([]));
  return knex;
});

const publishMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const auditLogMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockKnex,
}));

vi.mock("../../src/outbox/eventProducer.js", () => ({
  OutboxProducer: class {
    publish = publishMock;
  },
}));

vi.mock("../../src/services/audit.service.js", () => ({
  auditService: { log: auditLogMock },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const RUN_ROW = {
  id: "run-1",
  requested_by: "admin",
  filter: "{}",
  dry_run: true,
  reason: null,
  status: "running",
  total_matched: 0,
  total_replayed: 0,
  total_skipped: 0,
  error_message: null,
  started_at: "2024-01-01T00:00:00Z",
  completed_at: null,
  created_at: "2024-01-01T00:00:00Z",
};

describe("EventReplayService", () => {
  let service: EventReplayService;

  beforeEach(() => {
    vi.clearAllMocks();
    publishMock.mockResolvedValue(undefined);
    service = new EventReplayService();
  });

  describe("executeReplay", () => {
    it("rejects a real replay without explicit confirmation", async () => {
      await expect(
        service.executeReplay({ filter: {}, dryRun: false, requestedBy: "admin" })
      ).rejects.toThrow(/confirm=true/);
      expect(mockKnex).not.toHaveBeenCalled();
    });

    it("does not republish events on a dry run", async () => {
      const matchedEvents = [
        { id: "1", aggregate_type: "Alert", aggregate_id: "a1", sequence_no: 1, event_type: "alert.triggered", payload: "{}", status: "delivered" },
      ];

      mockKnex.mockImplementation((table: string) => {
        if (table === "event_replay_runs") {
          const builder = createQueryBuilder([RUN_ROW]);
          builder.returning = vi.fn().mockResolvedValue([
            { ...RUN_ROW, status: "completed", total_matched: 1, total_replayed: 0, total_skipped: 0 },
          ]);
          return builder;
        }
        return createQueryBuilder(matchedEvents);
      });

      const run = await service.executeReplay({ filter: {}, dryRun: true, requestedBy: "admin" });

      expect(publishMock).not.toHaveBeenCalled();
      expect(run.status).toBe("completed");
      expect(run.totalMatched).toBe(1);
      expect(run.totalReplayed).toBe(0);
    });

    it("republishes matched events with replay metadata when confirmed", async () => {
      const matchedEvents = [
        { id: "1", aggregate_type: "Alert", aggregate_id: "a1", sequence_no: 1, event_type: "alert.triggered", payload: "{}", status: "delivered" },
      ];

      mockKnex.mockImplementation((table: string) => {
        if (table === "event_replay_runs") {
          const builder = createQueryBuilder([RUN_ROW]);
          builder.returning = vi.fn().mockResolvedValue([
            { ...RUN_ROW, status: "completed", total_matched: 1, total_replayed: 1, total_skipped: 0 },
          ]);
          return builder;
        }
        return createQueryBuilder(matchedEvents);
      });

      const run = await service.executeReplay({
        filter: { aggregateType: "Alert" },
        dryRun: false,
        confirm: true,
        requestedBy: "admin",
        reason: "recovery test",
      });

      expect(publishMock).toHaveBeenCalledTimes(1);
      expect(publishMock).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType: "Alert",
          metadata: expect.objectContaining({ replay: true, originalEventId: "1" }),
        })
      );
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "event.replay_executed" })
      );
      expect(run.totalReplayed).toBe(1);
    });
  });

  describe("previewReplay", () => {
    it("returns matched count and a sample without replaying", async () => {
      mockKnex.mockImplementation(() => createQueryBuilder([{ count: "3" }]));
      const result = await service.previewReplay({ aggregateType: "Alert" });
      expect(publishMock).not.toHaveBeenCalled();
      expect(result.totalMatched).toBe(3);
    });
  });

  describe("listReplayRuns / getReplayRun", () => {
    it("caps the list limit at 200", async () => {
      const builder = createQueryBuilder([RUN_ROW]);
      mockKnex.mockImplementation(() => builder);

      await service.listReplayRuns(10_000);

      expect(builder.limit).toHaveBeenCalledWith(200);
    });

    it("returns null for an unknown run id", async () => {
      const builder = createQueryBuilder([]);
      builder.first = vi.fn().mockResolvedValue(undefined);
      mockKnex.mockImplementation(() => builder);

      const run = await service.getReplayRun("missing");
      expect(run).toBeNull();
    });
  });
});
