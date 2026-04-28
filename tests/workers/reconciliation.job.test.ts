import { describe, it, expect, vi, beforeEach } from "vitest";
import { createReconciliationProcessor } from "../../src/workers/reconciliation.job.js";

const verifySupplyMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "run-1" }));
const finishRunMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const acquireLockMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const releaseLockMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));

describe("reconciliation job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists success run when supplies match", async () => {
    verifySupplyMock.mockResolvedValueOnce({
      assetCode: "USDC",
      stellarSupply: 100,
      ethereumReserves: 100,
      mismatchPercentage: 0,
      isFlagged: false,
      match: true,
      errorStatus: null,
    });

    const processReconciliation = createReconciliationProcessor({
      bridgeService: { verifySupply: verifySupplyMock } as any,
      reconciliationService: { startRun: startRunMock, finishRun: finishRunMock } as any,
      acquireLock: acquireLockMock as any,
      releaseLock: releaseLockMock as any,
      lockTtlMs: 50,
    });

    await processReconciliation({
      id: "job-1",
      data: { assetCode: "USDC" },
      attemptsMade: 0,
    } as any);

    expect(startRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ assetCode: "USDC", jobId: "job-1", attempt: 1 })
    );
    expect(finishRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-1",
        status: "success",
        stellarSupply: 100,
        reportedSupply: 100,
        mismatchPercentage: 0,
      })
    );
  });

  it("persists mismatch run when flagged", async () => {
    verifySupplyMock.mockResolvedValueOnce({
      assetCode: "EURC",
      stellarSupply: 110,
      ethereumReserves: 100,
      mismatchPercentage: 10,
      isFlagged: true,
      match: false,
      errorStatus: null,
    });

    const processReconciliation = createReconciliationProcessor({
      bridgeService: { verifySupply: verifySupplyMock } as any,
      reconciliationService: { startRun: startRunMock, finishRun: finishRunMock } as any,
      acquireLock: acquireLockMock as any,
      releaseLock: releaseLockMock as any,
      lockTtlMs: 50,
    });

    await processReconciliation({
      id: "job-2",
      data: { assetCode: "EURC" },
      attemptsMade: 1,
    } as any);

    expect(finishRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-1", status: "mismatch" })
    );
  });
});

