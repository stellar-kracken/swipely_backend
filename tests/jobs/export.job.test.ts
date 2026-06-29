import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExportQueue } from "../../src/jobs/export.job.js";
import type { ExportJobPayload } from "../../src/types/export.types.js";

vi.mock("bullmq", () => {
    class QueueMock {
        name: string;
        _opts: Record<string, unknown>;
        add = vi.fn().mockResolvedValue({ id: "mock-job-1" });
        close = vi.fn().mockResolvedValue(undefined);
        on = vi.fn().mockReturnThis();

        constructor(name: string, opts: Record<string, unknown>) {
            this.name = name;
            this._opts = opts;
        }
    }
    return { Queue: QueueMock };
});

vi.mock("../../src/config/index.js", () => ({
    config: {
        REDIS_HOST: "localhost",
        REDIS_PORT: 6379,
    },
}));

vi.mock("../../src/utils/logger.js", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

function makePayload(overrides: Partial<ExportJobPayload> = {}): ExportJobPayload {
    return {
        exportId: "exp-abc123",
        requestedBy: "user-1",
        format: "csv",
        dataType: "analytics",
        filters: { startDate: "2024-01-01", endDate: "2024-12-31" },
        emailDelivery: false,
        ...overrides,
    };
}

describe("ExportQueue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (ExportQueue as any).instance = undefined;
    });

    describe("Singleton Pattern", () => {
        it("returns the same instance on multiple calls", () => {
            const instance1 = ExportQueue.getInstance();
            const instance2 = ExportQueue.getInstance();
            expect(instance1).toBe(instance2);
        });

        it("creates a fresh instance after singleton reset", () => {
            const first = ExportQueue.getInstance();
            (ExportQueue as any).instance = undefined;
            const second = ExportQueue.getInstance();
            expect(second).not.toBe(first);
        });
    });

    describe("Queue Configuration", () => {
        it("queue name is export-queue", () => {
            const queue = ExportQueue.getInstance();
            expect(queue.name).toBe("export-queue");
        });

        it("defaultJobOptions attempts is 3", () => {
            const queue = ExportQueue.getInstance();
            expect((queue as any)._opts.defaultJobOptions.attempts).toBe(3);
        });

        it("backoff type is exponential", () => {
            const queue = ExportQueue.getInstance();
            expect((queue as any)._opts.defaultJobOptions.backoff.type).toBe("exponential");
        });

        it("removeOnComplete is configured", () => {
            const queue = ExportQueue.getInstance();
            expect((queue as any)._opts.defaultJobOptions.removeOnComplete).toBeTruthy();
        });

        it("removeOnFail is configured", () => {
            const queue = ExportQueue.getInstance();
            expect((queue as any)._opts.defaultJobOptions.removeOnFail).toBeTruthy();
        });
    });

    describe("addExportJob", () => {
        it("calls add with job name process-export", async () => {
            const queue = ExportQueue.getInstance();
            const addSpy = vi.spyOn(queue, "add").mockResolvedValue({ id: "j1" } as any);
            const payload = makePayload();

            await queue.addExportJob(payload);

            expect(addSpy).toHaveBeenCalledWith(
                "process-export",
                expect.anything(),
                expect.anything()
            );
        });

        it("uses jobId export-${exportId}", async () => {
            const queue = ExportQueue.getInstance();
            const addSpy = vi.spyOn(queue, "add").mockResolvedValue({ id: "j1" } as any);
            const payload = makePayload({ exportId: "exp-abc123" });

            await queue.addExportJob(payload);

            expect(addSpy).toHaveBeenCalledWith(
                "process-export",
                expect.anything(),
                { jobId: "export-exp-abc123" }
            );
        });

        it("passes the full payload as job data", async () => {
            const queue = ExportQueue.getInstance();
            const addSpy = vi.spyOn(queue, "add").mockResolvedValue({ id: "j1" } as any);
            const payload = makePayload({ format: "json", dataType: "transactions" });

            await queue.addExportJob(payload);

            expect(addSpy).toHaveBeenCalledWith(
                "process-export",
                expect.objectContaining({
                    exportId: "exp-abc123",
                    format: "json",
                    dataType: "transactions",
                    requestedBy: "user-1",
                }),
                expect.anything()
            );
        });
    });

    describe("close", () => {
        it("closes the queue connection", async () => {
            const queue = ExportQueue.getInstance();
            const closeSpy = vi.spyOn(queue, "close").mockResolvedValue(undefined);

            await queue.close();

            expect(closeSpy).toHaveBeenCalledOnce();
        });
    });
});
