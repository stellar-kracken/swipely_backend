import { getDatabase } from "../database/connection.js";
import { config, SUPPORTED_ASSETS } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { HorizonClient } from "./stellar/horizon.client.js";
import { EthereumRpcClient } from "./ethereum/client.js";
import type { ChainId, ChainConfig } from "./ethereum/types.js";

interface TrackedBalanceRow {
  id: string;
  asset_code: string;
  asset_issuer: string | null;
  address_label: string;
  address: string;
  chain: string;
  address_type: string;
  current_balance: string;
  previous_balance: string;
  balance_change: string;
  change_percentage: string;
  last_checked_at: Date | null;
  last_changed_at: Date | null;
  metadata: Record<string, unknown> | null;
}

interface BalanceView {
  id: string;
  assetCode: string;
  addressLabel: string;
  address: string;
  chain: string;
  addressType: string;
  currentBalance: number;
  previousBalance: number;
  balanceChange: number;
  changePercentage: number;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  metadata: Record<string, unknown> | null;
}

interface BalanceTrackingOptions {
  significantChangeThresholdPct?: number;
}

interface BalanceSnapshotRequest {
  assetCode: string;
  assetIssuer?: string;
  addressLabel: string;
  address: string;
  chain: "stellar" | ChainId;
  addressType: "issuer" | "reserve" | "custody";
  tokenAddress?: string;
}

const DEFAULT_SIGNIFICANT_CHANGE_THRESHOLD = 5;

const DEFAULT_TRACKED_ADDRESSES: BalanceSnapshotRequest[] = [
  {
    assetCode: "USDC",
    assetIssuer: SUPPORTED_ASSETS.find((asset) => asset.code === "USDC")?.issuer,
    addressLabel: "USDC issuer",
    address: SUPPORTED_ASSETS.find((asset) => asset.code === "USDC")?.issuer ?? "",
    chain: "stellar",
    addressType: "issuer",
  },
  {
    assetCode: "EURC",
    assetIssuer: SUPPORTED_ASSETS.find((asset) => asset.code === "EURC")?.issuer,
    addressLabel: "EURC issuer",
    address: SUPPORTED_ASSETS.find((asset) => asset.code === "EURC")?.issuer ?? "",
    chain: "stellar",
    addressType: "issuer",
  },
];

function buildChainConfigs(): ChainConfig[] {
  const chains: ChainConfig[] = [];

  if (config.ETHEREUM_RPC_URL) {
    chains.push({
      chainId: "ethereum",
      name: "Ethereum Mainnet",
      rpcUrls: [config.ETHEREUM_RPC_URL, config.ETHEREUM_RPC_FALLBACK_URL].filter(Boolean) as string[],
      blockTime: 12,
      rateLimit: 10,
    });
  }

  if (config.POLYGON_RPC_URL) {
    chains.push({
      chainId: "polygon",
      name: "Polygon",
      rpcUrls: [config.POLYGON_RPC_URL, config.POLYGON_RPC_FALLBACK_URL].filter(Boolean) as string[],
      blockTime: 2,
      rateLimit: 10,
    });
  }

  if (config.BASE_RPC_URL) {
    chains.push({
      chainId: "base",
      name: "Base",
      rpcUrls: [config.BASE_RPC_URL, config.BASE_RPC_FALLBACK_URL].filter(Boolean) as string[],
      blockTime: 2,
      rateLimit: 10,
    });
  }

  return chains;
}

export class BalanceService {
  private readonly db = getDatabase();
  private readonly horizonClient = new HorizonClient();
  private readonly ethereumClient = buildChainConfigs().length
    ? new EthereumRpcClient(buildChainConfigs())
    : null;
  private streamClosers = new Map<string, () => void>();

  async syncTrackedBalances(
    addresses: BalanceSnapshotRequest[] = DEFAULT_TRACKED_ADDRESSES,
    options: BalanceTrackingOptions = {},
  ): Promise<{ synced: number; alerts: number }> {
    let synced = 0;
    let alerts = 0;

    for (const request of addresses) {
      if (!request.address) continue;
      const snapshot = await this.fetchBalanceSnapshot(request);
      const result = await this.upsertBalanceSnapshot(snapshot, options);
      synced += 1;
      if (result.significantChange) alerts += 1;
    }

    return { synced, alerts };
  }

  async listBalances(assetCode?: string): Promise<BalanceView[]> {
    const query = this.db("tracked_balances").select<TrackedBalanceRow[]>("*").orderBy("asset_code", "asc");
    if (assetCode) query.where("asset_code", assetCode);
    const rows = (await query) as unknown as TrackedBalanceRow[];
    return rows.map((row) => this.mapRow(row));
  }

  async getBalanceHistory(assetCode: string, limit = 100): Promise<Array<Record<string, unknown>>> {
    return this.db("balance_history")
      .select("*")
      .where({ asset_code: assetCode })
      .orderBy("recorded_at", "desc")
      .limit(limit);
  }

  async getCrossChainComparison(assetCode: string): Promise<{
    assetCode: string;
    totalTracked: number;
    byChain: Array<{ chain: string; balance: number }>;
    spread: number;
  }> {
    const rows = await this.db("tracked_balances")
      .select("chain")
      .sum({ balance: "current_balance" })
      .where({ asset_code: assetCode })
      .groupBy("chain");

    const byChain = rows.map((row: any) => ({ chain: row.chain, balance: Number(row.balance ?? 0) }));
    const balances = byChain.map((row) => row.balance);
    const spread = balances.length ? Math.max(...balances) - Math.min(...balances) : 0;
    const totalTracked = balances.reduce((sum, value) => sum + value, 0);

    return { assetCode, totalTracked, byChain, spread };
  }

  async reconcileBalances(assetCode: string): Promise<{
    assetCode: string;
    issuerBalance: number;
    reserveBalance: number;
    custodyBalance: number;
    delta: number;
  }> {
    const rows = await this.db("tracked_balances")
      .select("address_type")
      .sum({ balance: "current_balance" })
      .where({ asset_code: assetCode })
      .groupBy("address_type");

    const byType = new Map(rows.map((row: any) => [row.address_type, Number(row.balance ?? 0)]));
    const issuerBalance = byType.get("issuer") ?? 0;
    const reserveBalance = byType.get("reserve") ?? 0;
    const custodyBalance = byType.get("custody") ?? 0;
    const delta = issuerBalance - (reserveBalance + custodyBalance);

    return {
      assetCode,
      issuerBalance,
      reserveBalance,
      custodyBalance,
      delta,
    };
  }

  async startRealTimeTracking(addresses: BalanceSnapshotRequest[] = DEFAULT_TRACKED_ADDRESSES): Promise<void> {
    for (const tracked of addresses.filter((item) => item.chain === "stellar" && item.address)) {
      const key = `${tracked.chain}:${tracked.address}:${tracked.assetCode}`;
      if (this.streamClosers.has(key)) continue;

      const close = this.horizonClient.streamAccountTransactions(
        tracked.address,
        async () => {
          try {
            await this.syncTrackedBalances([tracked]);
          } catch (error) {
            logger.error({ tracked, error }, "Failed to refresh tracked balance from Horizon stream");
          }
        },
        (error) => {
          logger.error({ tracked, error }, "Balance tracking stream error");
        },
      );

      this.streamClosers.set(key, close);
    }
  }

  async stopRealTimeTracking(): Promise<void> {
    for (const close of this.streamClosers.values()) {
      close();
    }
    this.streamClosers.clear();
  }

  private async fetchBalanceSnapshot(request: BalanceSnapshotRequest): Promise<BalanceSnapshotRequest & { balance: number; blockNumber: number | null; metadata: Record<string, unknown> | null }> {
    if (request.chain === "stellar") {
      const account = await this.horizonClient.getAccount(request.address);
      const match = account.balances.find((line) => {
        const [code, issuer] = line.asset.split(":");
        return code === request.assetCode && (request.assetIssuer ? issuer === request.assetIssuer : true);
      });

      return {
        ...request,
        balance: Number(match?.balance ?? 0),
        blockNumber: account.lastModifiedLedger,
        metadata: {
          source: "horizon",
          subentryCount: account.subentryCount,
        },
      };
    }

    if (!this.ethereumClient || !request.tokenAddress) {
      return {
        ...request,
        balance: 0,
        blockNumber: null,
        metadata: {
          source: "evm-unavailable",
        },
      };
    }

    const result = await this.ethereumClient.getTokenBalance(request.chain, request.tokenAddress, request.address);
    const blockNumber = await this.ethereumClient.getBlockNumber(request.chain);

    return {
      ...request,
      balance: Number(result.formatted),
      blockNumber,
      metadata: {
        source: "evm-rpc",
        tokenAddress: request.tokenAddress,
      },
    };
  }

  private async upsertBalanceSnapshot(
    snapshot: BalanceSnapshotRequest & { balance: number; blockNumber: number | null; metadata: Record<string, unknown> | null },
    options: BalanceTrackingOptions,
  ): Promise<{ significantChange: boolean }> {
    const threshold = options.significantChangeThresholdPct ?? DEFAULT_SIGNIFICANT_CHANGE_THRESHOLD;
    const existing = (await this.db("tracked_balances")
      .select<TrackedBalanceRow[]>("*")
      .where({ address: snapshot.address, chain: snapshot.chain, asset_code: snapshot.assetCode })
      .first()) as unknown as TrackedBalanceRow | undefined;

    const previousBalance = Number(existing?.current_balance ?? 0);
    const balanceChange = snapshot.balance - previousBalance;
    const changePercentage = previousBalance === 0 ? (snapshot.balance > 0 ? 100 : 0) : (balanceChange / previousBalance) * 100;
    const significantChange = Math.abs(changePercentage) >= threshold;
    const now = new Date();

    const [row] = await this.db("tracked_balances")
      .insert({
        asset_code: snapshot.assetCode,
        asset_issuer: snapshot.assetIssuer ?? null,
        address_label: snapshot.addressLabel,
        address: snapshot.address,
        chain: snapshot.chain,
        address_type: snapshot.addressType,
        current_balance: snapshot.balance,
        previous_balance: previousBalance,
        balance_change: balanceChange,
        change_percentage: changePercentage,
        last_checked_at: now,
        last_changed_at: significantChange ? now : existing?.last_changed_at ?? null,
        metadata: snapshot.metadata,
        created_at: now,
        updated_at: now,
      })
      .onConflict(["address", "chain", "asset_code"])
      .merge({
        address_label: snapshot.addressLabel,
        asset_issuer: snapshot.assetIssuer ?? null,
        current_balance: snapshot.balance,
        previous_balance: previousBalance,
        balance_change: balanceChange,
        change_percentage: changePercentage,
        last_checked_at: now,
        last_changed_at: significantChange ? now : existing?.last_changed_at ?? null,
        metadata: snapshot.metadata,
        updated_at: now,
      })
      .returning("*");

    await this.db("balance_history").insert({
      tracked_balance_id: row.id,
      asset_code: snapshot.assetCode,
      chain: snapshot.chain,
      address: snapshot.address,
      balance: snapshot.balance,
      balance_change: balanceChange,
      change_percentage: changePercentage,
      block_number: snapshot.blockNumber,
      recorded_at: now,
      metadata: snapshot.metadata,
    });

    if (significantChange) {
      logger.warn(
        {
          assetCode: snapshot.assetCode,
          address: snapshot.address,
          chain: snapshot.chain,
          changePercentage,
        },
        "Significant balance change detected",
      );
    }

    return { significantChange };
  }

  private mapRow(row: TrackedBalanceRow): BalanceView {
    return {
      id: row.id,
      assetCode: row.asset_code,
      addressLabel: row.address_label,
      address: row.address,
      chain: row.chain,
      addressType: row.address_type,
      currentBalance: Number(row.current_balance),
      previousBalance: Number(row.previous_balance),
      balanceChange: Number(row.balance_change),
      changePercentage: Number(row.change_percentage),
      lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
      lastChangedAt: row.last_changed_at?.toISOString() ?? null,
      metadata: row.metadata,
    };
  }
}
