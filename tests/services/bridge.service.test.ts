import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BridgeService } from "../../src/services/bridge.service.js";
import { getStellarAssetSupply } from "../../src/utils/stellar.js";
import { getEthereumTokenBalance } from "../../src/utils/ethereum.js";
import { getDatabase } from "../../src/database/connection.js";
import { config } from "../../src/config/index.js";

// Mock utilities
vi.mock("../../src/utils/logger.js", () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock("../../src/utils/stellar.js", () => ({
    getStellarAssetSupply: vi.fn(),
}));

vi.mock("../../src/utils/ethereum.js", () => ({
    getEthereumTokenBalance: vi.fn(),
}));

// Mock database
const mockInsert = vi.fn().mockResolvedValue([1]);
const mockDb = vi.fn().mockReturnValue({
    insert: mockInsert,
});

vi.mock("../../src/database/connection.js", () => ({
    getDatabase: () => mockDb,
}));

// Mock config
vi.mock("../../src/config/index.js", () => ({
    config: {
        RETRY_MAX: 0, // Disable retries for unit tests to speed up
        BRIDGE_SUPPLY_MISMATCH_THRESHOLD: 0.1,
        USDC_BRIDGE_ADDRESS: "0xBridgeUSDC",
        USDC_TOKEN_ADDRESS: "0xTokenUSDC",
        EURC_BRIDGE_ADDRESS: "0xBridgeEURC",
        EURC_TOKEN_ADDRESS: "0xTokenEURC",
    },
    SUPPORTED_ASSETS: [
        { code: "USDC", issuer: "G_USDC" },
        { code: "EURC", issuer: "G_EURC" },
    ],
}));

describe("BridgeService", () => {
    let bridgeService: BridgeService;

    beforeEach(() => {
        bridgeService = new BridgeService();
        vi.clearAllMocks();
    });

    describe("fetchStellarSupply", () => {
        it("fetches supply from Stellar util", async () => {
            vi.mocked(getStellarAssetSupply).mockResolvedValue(1000);
            const supply = await bridgeService.fetchStellarSupply("USDC");
            expect(supply).toBe(1000);
            expect(getStellarAssetSupply).toHaveBeenCalledWith("USDC", "G_USDC");
        });

        it("throws error for unsupported asset", async () => {
            await expect(bridgeService.fetchStellarSupply("UNKNOWN")).rejects.toThrow("not supported on Stellar");
        });
    });

    describe("fetchEthereumReserves", () => {
        it("fetches reserves from Ethereum util", async () => {
            vi.mocked(getEthereumTokenBalance).mockResolvedValue(2000);
            const reserves = await bridgeService.fetchEthereumReserves("USDC");
            expect(reserves).toBe(2000);
            expect(getEthereumTokenBalance).toHaveBeenCalledWith("0xTokenUSDC", "0xBridgeUSDC");
        });

        it("throws error if addresses are missing", async () => {
            // In this mock USDC and EURC are present. Let's assume another one isn't.
            await expect(bridgeService.fetchEthereumReserves("PYUSD")).rejects.toThrow("not configured");
        });
    });

    describe("verifySupply", () => {
        it("returns match: true when mismatch is within threshold", async () => {
            vi.mocked(getStellarAssetSupply).mockResolvedValue(1000);
            vi.mocked(getEthereumTokenBalance).mockResolvedValue(1000.5); // 0.05% mismatch

            const result = await bridgeService.verifySupply("USDC");

            expect(result.match).toBe(true);
            expect(result.isFlagged).toBe(false);
            expect(result.mismatchPercentage).toBeLessThan(0.1);
            expect(mockInsert).toHaveBeenCalled();
        });

        it("returns isFlagged: true when mismatch exceeds threshold", async () => {
            vi.mocked(getStellarAssetSupply).mockResolvedValue(1000);
            vi.mocked(getEthereumTokenBalance).mockResolvedValue(900); // 11.11% mismatch

            const result = await bridgeService.verifySupply("USDC");

            expect(result.match).toBe(false);
            expect(result.isFlagged).toBe(true);
            expect(result.mismatchPercentage).toBeCloseTo(11.11, 2);
        });

        it("handles fetch failures gracefully and stores error status", async () => {
            vi.mocked(getStellarAssetSupply).mockRejectedValue(new Error("Stellar Down"));

            const result = await bridgeService.verifySupply("USDC");

            expect(result.match).toBe(false);
            expect(result.errorStatus).toContain("Stellar Down");
            expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
                error_status: expect.stringContaining("Stellar Down")
            }));
        });

        it("handles zero reserves with positive stellar supply as 100% mismatch", async () => {
            vi.mocked(getStellarAssetSupply).mockResolvedValue(100);
            vi.mocked(getEthereumTokenBalance).mockResolvedValue(0);

            const result = await bridgeService.verifySupply("USDC");
            expect(result.mismatchPercentage).toBe(100);
            expect(result.isFlagged).toBe(true);
        });

        it("handles database write failure without crashing", async () => {
            vi.mocked(getStellarAssetSupply).mockResolvedValue(1000);
            vi.mocked(getEthereumTokenBalance).mockResolvedValue(1000);
            mockInsert.mockRejectedValueOnce(new Error("DB Error"));

            const result = await bridgeService.verifySupply("USDC");
            expect(result.match).toBe(true);
            // Should log error but return result
        });
    });
});
