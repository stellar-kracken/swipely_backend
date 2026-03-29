import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockScVal {
    constructor(public readonly value: unknown) {}
  }

  const contractCall = vi.fn(function (this: { contractId: string }, functionName: string, ...args: unknown[]) {
    return { contractId: this.contractId, functionName, args };
  });

  class MockContract {
    constructor(public readonly contractId: string) {}

    call = contractCall;
  }

  class MockAccount {
    constructor(public readonly accountId: string, public readonly sequence: string) {}
  }

  class MockKeypair {
    static random = vi.fn(() => ({ publicKey: () => "GTESTKEYPAIR" }));
  }

  class MockTransactionBuilder {
    operation: unknown;
    timeoutSeconds: number | undefined;

    constructor(
      public readonly account: MockAccount,
      public readonly options: { fee: string; networkPassphrase: string }
    ) {}

    addOperation = vi.fn((operation: unknown) => {
      this.operation = operation;
      return this;
    });

    setTimeout = vi.fn((seconds: number) => {
      this.timeoutSeconds = seconds;
      return this;
    });

    build = vi.fn(() => ({
      account: this.account,
      options: this.options,
      operation: this.operation,
      timeoutSeconds: this.timeoutSeconds,
      sign: vi.fn(),
    }));
  }

  return {
    MockScVal,
    MockContract,
    MockAccount,
    MockKeypair,
    MockTransactionBuilder,
  };
});

vi.mock("@stellar/stellar-sdk", () => ({
  BASE_FEE: 100,
  Networks: {
    PUBLIC: "PUBLIC",
    TESTNET: "TESTNET",
  },
  Account: mocks.MockAccount,
  Contract: mocks.MockContract,
  Keypair: mocks.MockKeypair,
  TransactionBuilder: mocks.MockTransactionBuilder,
  nativeToScVal: (value: unknown) => new mocks.MockScVal(value),
  scValToNative: (value: unknown) => (value instanceof mocks.MockScVal ? value.value : value),
  xdr: {
    ScVal: mocks.MockScVal,
  },
  SorobanRpc: {
    Server: class ServerMock {},
    Api: {
      isSimulationError: (value: unknown) => Boolean((value as { error?: unknown } | null | undefined)?.error),
    },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../src/config/index.js", () => ({
  config: {
    STELLAR_NETWORK: "testnet",
    SOROBAN_RPC_URL: "https://primary.rpc",
    SOROBAN_MAINNET_RPC_URL: "https://mainnet.rpc",
    NODE_ENV: "development",
  },
}));

import { SorobanRpcClient } from "../../../src/services/stellar/soroban.client.js";

function createServerMock() {
  return {
    getAccount: vi.fn(),
    getContractData: vi.fn(),
    prepareTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
    simulateTransaction: vi.fn(),
    getEvents: vi.fn(),
    getNetwork: vi.fn(),
    getLatestLedger: vi.fn(),
    getFeeStats: vi.fn(),
  };
}

describe("SorobanRpcClient", () => {
  let primaryServer: ReturnType<typeof createServerMock>;
  let fallbackServer: ReturnType<typeof createServerMock>;

  beforeEach(() => {
    primaryServer = createServerMock();
    fallbackServer = createServerMock();
    vi.clearAllMocks();
  });

  it("uses the mainnet RPC URL and passphrase when configured for mainnet", () => {
    const createdUrls: string[] = [];

    const client = new SorobanRpcClient({
      network: "mainnet",
      createServer: (url) => {
        createdUrls.push(url);
        return primaryServer as any;
      },
    });

    expect(createdUrls).toEqual(["https://mainnet.rpc"]);
    expect(client.getNetworkPassphrase()).toBe("PUBLIC");
  });

  it("builds contract invocations with the configured network passphrase", async () => {
    primaryServer.getAccount.mockResolvedValue(new mocks.MockAccount("GACCOUNT", "123"));

    const client = new SorobanRpcClient({
      rpcUrls: ["https://primary.rpc"],
      createServer: () => primaryServer as any,
    });

    const transaction = await client.buildInvocationTransaction({
      contractId: "C123",
      functionName: "commit_reserves",
      args: ["bridge-1", 42n],
      sourceAccount: "GACCOUNT",
      timeoutSeconds: 45,
    });

    expect(primaryServer.getAccount).toHaveBeenCalledWith("GACCOUNT");
    expect((transaction as any).options.networkPassphrase).toBe("TESTNET");
    expect((transaction as any).options.fee).toBe("100");
    expect((transaction as any).timeoutSeconds).toBe(45);
    expect((transaction as any).operation).toMatchObject({
      contractId: "C123",
      functionName: "commit_reserves",
    });
    expect((transaction as any).operation.args[0]).toBeInstanceOf(mocks.MockScVal);
    expect((transaction as any).operation.args[1]).toBeInstanceOf(mocks.MockScVal);
  });

  it("falls back to the next RPC endpoint when the first read fails", async () => {
    primaryServer.getContractData.mockRejectedValueOnce(new Error("primary down"));
    fallbackServer.getContractData.mockResolvedValueOnce({ val: new mocks.MockScVal({ ready: true }) });

    const client = new SorobanRpcClient({
      rpcUrls: ["https://primary.rpc", "https://fallback.rpc"],
      createServer: (url) => (url === "https://primary.rpc" ? (primaryServer as any) : (fallbackServer as any)),
    });

    const result = await client.readContractData({
      contractId: "C123",
      key: new mocks.MockScVal("counter"),
    });

    expect(result).toEqual({ ready: true });
    expect(primaryServer.getContractData).toHaveBeenCalledTimes(1);
    expect(fallbackServer.getContractData).toHaveBeenCalledTimes(1);
  });

  it("invokes, signs, and tracks a contract transaction", async () => {
    primaryServer.getAccount.mockResolvedValue(new mocks.MockAccount("GACCOUNT", "123"));

    const preparedTransaction = { sign: vi.fn() };
    primaryServer.prepareTransaction.mockResolvedValue(preparedTransaction);
    primaryServer.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "tx-hash" });
    primaryServer.getTransaction
      .mockResolvedValueOnce({ status: "PENDING" })
      .mockResolvedValueOnce({ status: "SUCCESS", returnValue: new mocks.MockScVal("ok") });

    const client = new SorobanRpcClient({
      rpcUrls: ["https://primary.rpc"],
      createServer: () => primaryServer as any,
      sleep: async () => undefined,
      transactionPollAttempts: 3,
      transactionPollDelayMs: 0,
    });

    const result = await client.invokeContract({
      contractId: "C123",
      functionName: "commit_reserves",
      args: ["bridge-1", 42n],
      signer: { publicKey: () => "GACCOUNT" } as any,
      sourceAccount: "GACCOUNT",
    });

    expect(preparedTransaction.sign).toHaveBeenCalledTimes(1);
    expect(primaryServer.sendTransaction).toHaveBeenCalledWith(preparedTransaction);
    expect(primaryServer.getTransaction).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("success");
    expect(result.returnValue).toBe("ok");
  });

  it("estimates gas from simulation data", async () => {
    primaryServer.simulateTransaction.mockResolvedValueOnce({
      minResourceFee: 789,
      cost: {
        cpuInsns: 123,
        memBytes: 456,
      },
      result: {
        retval: new mocks.MockScVal("ignored"),
      },
    });
    primaryServer.getAccount.mockResolvedValue(new mocks.MockAccount("GACCOUNT", "123"));

    const client = new SorobanRpcClient({
      rpcUrls: ["https://primary.rpc"],
      createServer: () => primaryServer as any,
    });

    const estimate = await client.estimateGas({
      contractId: "C123",
      functionName: "commit_reserves",
      args: ["bridge-1", 42n],
      sourceAccount: "GACCOUNT",
    });

    expect(estimate.minResourceFee).toBe(789);
    expect(estimate.cpuInstructions).toBe(123);
    expect(estimate.memoryBytes).toBe(456);
  });

  it("batches contract state reads and streams events", async () => {
    primaryServer.getContractData
      .mockResolvedValueOnce({ val: new mocks.MockScVal("one") })
      .mockResolvedValueOnce({ val: new mocks.MockScVal("two") });
    primaryServer.getEvents.mockResolvedValueOnce({
      events: [{ pagingToken: "1", type: "contract", value: "committed" }],
    });

    const client = new SorobanRpcClient({
      rpcUrls: ["https://primary.rpc"],
      createServer: () => primaryServer as any,
      sleep: async () => undefined,
    });

    const values = await client.batchReadContractData([
      { contractId: "C123", key: new mocks.MockScVal("key-1") },
      { contractId: "C123", key: new mocks.MockScVal("key-2") },
    ]);

    expect(values).toEqual(["one", "two"]);

    const iterator = client.streamEvents({ startLedger: 1000 }, { pollIntervalMs: 0 });
    const firstEvent = await iterator.next();

    expect(firstEvent.value).toMatchObject({ pagingToken: "1", value: "committed" });

    await iterator.return?.();
  });
});
