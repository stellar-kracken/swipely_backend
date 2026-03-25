import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiquidityService } from "../../src/services/liquidity.service.js";

const {
  simulateTransaction,
  scValToNative,
  contractCall,
} = vi.hoisted(() => ({
  simulateTransaction: vi.fn(),
  scValToNative: vi.fn(),
  contractCall: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    NODE_ENV: "test",
    SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
    STELLAR_NETWORK: "testnet",
    LIQUIDITY_CONTRACT_ADDRESS: "CDUMMYLIQUIDITYCONTRACT",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@stellar/stellar-sdk", () => {
  class Server {
    constructor(_url: string, _opts: unknown) {}
    simulateTransaction = simulateTransaction;
  }

  class Contract {
    constructor(_address: string) {}
    call = contractCall;
  }

  class Account {
    constructor(publicKey: string, sequence: string) {
      void publicKey;
      void sequence;
    }
  }

  class TransactionBuilder {
    addOperation(op: unknown) {
      return {
        setTimeout: (_timeout: number) => ({
          build: () => ({ op }),
        }),
      };
    }
    constructor(_account: unknown, _opts: unknown) {}
  }

  return {
    Networks: {
      TESTNET: "Test SDF Network ; September 2015",
      PUBLIC: "Public Global Stellar Network ; September 2015",
    },
    SorobanRpc: {
      Server,
      Api: {
        isSimulationError: (result: { error?: string }) => Boolean(result.error),
      },
    },
    Contract,
    Account,
    Keypair: {
      random: () => ({
        publicKey: () => "GDUMMY",
      }),
    },
    TransactionBuilder,
    xdr: {
      ScVal: {
        scvString: (value: string) => value,
      },
    },
    scValToNative,
  };
});

describe("LiquidityService", () => {
  let liquidityService: LiquidityService;

  beforeEach(() => {
    liquidityService = new LiquidityService();
    vi.clearAllMocks();
    contractCall.mockImplementation((method: string, assetPair: string) => ({
      method,
      assetPair,
    }));
    simulateTransaction.mockImplementation(async (tx: { op: { assetPair: string } }) => ({
      result: { retval: { assetPair: tx.op.assetPair } },
    }));
    scValToNative.mockImplementation((retval: { assetPair: string }) => {
      const snapshots: Record<string, object> = {
        "USDC/XLM": {
          asset_pair: "USDC/XLM",
          total_liquidity: 1_000_000,
          depth_0_1_pct: 100_000,
          depth_0_5_pct: 250_000,
          depth_1_pct: 500_000,
          depth_5_pct: 900_000,
          sources: ["StellarX", "Phoenix"],
          timestamp: 1_700_000_000,
        },
        "FOBXX/USDC": {
          asset_pair: "FOBXX/USDC",
          total_liquidity: 4_000_000,
          depth_0_1_pct: 300_000,
          depth_0_5_pct: 900_000,
          depth_1_pct: 1_500_000,
          depth_5_pct: 3_000_000,
          sources: ["SDEX"],
          timestamp: 1_700_000_100,
        },
      };

      return snapshots[retval.assetPair] ?? null;
    });
  });

  it("aggregates contract-backed pair liquidity for an asset", async () => {
    const result = await liquidityService.getAggregatedLiquidity("USDC");

    expect(result).not.toBeNull();
    expect(result?.symbol).toBe("USDC");
    expect(result?.totalLiquidity).toBe(5_000_000);
    expect(result?.sources).toHaveLength(3);
    expect(result?.sources.map((source) => source.pair)).toEqual([
      "USDC/XLM",
      "USDC/XLM",
      "FOBXX/USDC",
    ]);
  });

  it("filters aggregated liquidity down to a single dex", async () => {
    const result = await liquidityService.getDexLiquidity("USDC", "Phoenix");

    expect(result).not.toBeNull();
    expect(result?.dex).toBe("Phoenix");
    expect(result?.pair).toBe("USDC/XLM");
  });

  it("returns null for unsupported symbols", async () => {
    const result = await liquidityService.getAggregatedLiquidity("BTC");
    expect(result).toBeNull();
  });
});
