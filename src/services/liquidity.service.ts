import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

export interface LiquiditySource {
  dex: string;
  pair: string;
  totalLiquidity: number;
  bidDepth: number;
  askDepth: number;
  lastUpdated: string;
}

export interface AggregatedLiquidity {
  symbol: string;
  totalLiquidity: number;
  sources: LiquiditySource[];
  bestBid: { dex: string; price: number };
  bestAsk: { dex: string; price: number };
}

interface ContractLiquidityDepth {
  asset_pair: string;
  total_liquidity: string | number | bigint;
  depth_0_1_pct: string | number | bigint;
  depth_0_5_pct: string | number | bigint;
  depth_1_pct: string | number | bigint;
  depth_5_pct: string | number | bigint;
  sources: string[];
  timestamp: string | number | bigint;
}

const PHASE1_PAIR_MAP: Record<string, string[]> = {
  USDC: ["USDC/XLM", "FOBXX/USDC"],
  EURC: ["EURC/XLM"],
  PYUSD: ["PYUSD/XLM"],
  FOBXX: ["FOBXX/USDC"],
  XLM: ["USDC/XLM", "EURC/XLM", "PYUSD/XLM"],
};

function getSorobanServer(): StellarSdk.SorobanRpc.Server {
  return new StellarSdk.SorobanRpc.Server(config.SOROBAN_RPC_URL, {
    allowHttp: config.NODE_ENV === "development",
  });
}

function getNetworkPassphrase(): string {
  return config.STELLAR_NETWORK === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;
}

function toNumber(value: string | number | bigint | undefined): number {
  if (value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

export class LiquidityService {
  /**
   * Get aggregated liquidity data for a Phase 1 asset by reading the latest
   * pair-level liquidity snapshots from the Soroban contract.
   */
  async getAggregatedLiquidity(symbol: string): Promise<AggregatedLiquidity | null> {
    logger.info({ symbol }, "Fetching aggregated liquidity");

    if (!config.LIQUIDITY_CONTRACT_ADDRESS) {
      logger.warn("LIQUIDITY_CONTRACT_ADDRESS is not configured");
      return null;
    }

    const pairs = this.getPairsForSymbol(symbol);
    if (pairs.length === 0) {
      return null;
    }

    const snapshots = await Promise.all(
      pairs.map((pair) => this.fetchPairLiquidityDepth(pair))
    );
    const validSnapshots = snapshots.filter(
      (snapshot): snapshot is ContractLiquidityDepth => snapshot !== null
    );

    if (validSnapshots.length === 0) {
      return null;
    }

    const sources: LiquiditySource[] = [];
    let totalLiquidity = 0;

    for (const snapshot of validSnapshots) {
      totalLiquidity += toNumber(snapshot.total_liquidity);
      const timestampIso = new Date(toNumber(snapshot.timestamp) * 1000).toISOString();
      const sourceCount = snapshot.sources.length || 1;
      const sourceLiquidity = toNumber(snapshot.total_liquidity) / sourceCount;

      for (const dex of snapshot.sources) {
        sources.push({
          dex,
          pair: snapshot.asset_pair,
          totalLiquidity: sourceLiquidity,
          bidDepth: toNumber(snapshot.depth_0_5_pct),
          askDepth: toNumber(snapshot.depth_1_pct),
          lastUpdated: timestampIso,
        });
      }
    }

    return {
      symbol,
      totalLiquidity,
      sources,
      bestBid: { dex: sources[0]?.dex ?? "aggregated", price: 0 },
      bestAsk: { dex: sources[0]?.dex ?? "aggregated", price: 0 },
    };
  }

  /**
   * Get liquidity from a specific DEX by filtering the aggregated contract-backed result.
   */
  async getDexLiquidity(symbol: string, dex: string): Promise<LiquiditySource | null> {
    logger.info({ symbol, dex }, "Fetching DEX-specific liquidity");

    const aggregated = await this.getAggregatedLiquidity(symbol);
    if (!aggregated) {
      return null;
    }

    return aggregated.sources.find((source) => source.dex === dex) ?? null;
  }

  /**
   * Calculate optimal trade route across DEXs.
   */
  async getBestRoute(
    fromSymbol: string,
    toSymbol: string,
    amount: number
  ): Promise<{ route: string[]; estimatedOutput: number }> {
    logger.info({ fromSymbol, toSymbol, amount }, "Calculating best route");

    const pair = `${fromSymbol}/${toSymbol}`;
    const inversePair = `${toSymbol}/${fromSymbol}`;
    const snapshot =
      (await this.fetchPairLiquidityDepth(pair)) ??
      (await this.fetchPairLiquidityDepth(inversePair));

    if (!snapshot) {
      return { route: [], estimatedOutput: 0 };
    }

    const route = snapshot.sources.length > 0 ? [snapshot.sources[0]] : [];
    const executableLiquidity = Math.min(
      amount,
      toNumber(snapshot.depth_1_pct)
    );

    return {
      route,
      estimatedOutput: executableLiquidity,
    };
  }

  private getPairsForSymbol(symbol: string): string[] {
    return PHASE1_PAIR_MAP[symbol.toUpperCase()] ?? [];
  }

  private async fetchPairLiquidityDepth(
    assetPair: string
  ): Promise<ContractLiquidityDepth | null> {
    const server = getSorobanServer();
    const contract = new StellarSdk.Contract(config.LIQUIDITY_CONTRACT_ADDRESS!);
    const account = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "0");

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          "get_aggregated_liquidity_depth",
          StellarSdk.xdr.ScVal.scvString(assetPair)
        )
      )
      .setTimeout(10)
      .build();

    const simResult = await server.simulateTransaction(tx);
    if (StellarSdk.SorobanRpc.Api.isSimulationError(simResult)) {
      logger.warn({ assetPair, error: simResult.error }, "Liquidity depth simulation failed");
      return null;
    }

    const retval = simResult.result?.retval;
    if (!retval) {
      return null;
    }

    const nativeValue = StellarSdk.scValToNative(retval) as
      | ContractLiquidityDepth
      | null
      | undefined;

    return nativeValue ?? null;
  }
}
