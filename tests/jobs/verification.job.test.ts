import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeService } from "../../src/services/bridge.service.js";
import { logger } from "../../src/utils/logger.js";
import { runBridgeVerification, startBridgeVerificationJob, stopBridgeVerificationJob } from "../../src/jobs/verification.job.js";

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// Mock config
vi.mock("../../src/config/index.js", () => ({
    config: {
        BRIDGE_VERIFICATION_INTERVAL_MS: 300000,
        BRIDGE_SUPPLY_MISMATCH_THRESHOLD: 0.1,
    },
}));

describe("Verification Job", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("runs verification for all assets", async () => {
        const spy = vi.spyOn(BridgeService.prototype, 'verifySupply').mockResolvedValue({
            isFlagged: false,
            mismatchPercentage: 0,
            match: true,
            assetCode: "USDC",
            stellarSupply: 100,
            ethereumReserves: 100
        });

        await runBridgeVerification();

        expect(spy).toHaveBeenCalledTimes(2); // USDC, EURC
        expect(logger.info).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("successfully"));
    });

    it("logs error when verification is flagged", async () => {
        const spy = vi.spyOn(BridgeService.prototype, 'verifySupply').mockResolvedValue({
            isFlagged: true,
            mismatchPercentage: 5.0,
            match: false,
            assetCode: "USDC",
            stellarSupply: 105,
            ethereumReserves: 100
        });

        await runBridgeVerification();

        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("CRITICAL"));
    });

    it("logs warning when verification has error status", async () => {
        const spy = vi.spyOn(BridgeService.prototype, 'verifySupply').mockResolvedValue({
            errorStatus: "Fetch failed",
            isFlagged: false,
            match: false,
            assetCode: "USDC",
            mismatchPercentage: 0,
            stellarSupply: 0,
            ethereumReserves: 0
        });

        await runBridgeVerification();

        expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("skipped or failed"));
    });

    it("continues processing remaining assets if one fails unexpectedly", async () => {
        const spy = vi.spyOn(BridgeService.prototype, 'verifySupply')
            .mockRejectedValueOnce(new Error("Unexpected crash"))
            .mockResolvedValueOnce({
                isFlagged: false,
                mismatchPercentage: 0,
                match: true,
                assetCode: "EURC",
                stellarSupply: 100,
                ethereumReserves: 100
            });

        await runBridgeVerification();

        expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("Unexpected failure"));
        expect(spy).toHaveBeenCalledTimes(2);
    });

    it("starts and stops the verification job", () => {
        vi.useFakeTimers();
        startBridgeVerificationJob();
        expect(logger.info).toHaveBeenCalledWith(expect.anything(), "Initializing scheduled bridge verification job");

        stopBridgeVerificationJob();
        expect(logger.info).toHaveBeenCalledWith("Stopped scheduled bridge verification job");
        vi.useRealTimers();
    });
});
