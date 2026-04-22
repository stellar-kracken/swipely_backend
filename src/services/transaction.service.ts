import * as StellarSdk from "@stellar/stellar-sdk";
import { getDatabase } from "../database/connection.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

const HORIZON_REQUEST_DELAY_MS = 120;
const DEFAULT_PAGE_SIZE = 200;

type HorizonOrder = "asc" | "desc";

export interface TransactionFetchOptions {
  bridgeName?: string;
  cursor?: string;
  pageSize?: number;
  maxPages?: number;
  order?: HorizonOrder;
  operationTypes?: string[];
}

export interface TransactionBackfillOptions extends Omit<TransactionFetchOptions, "order"> {
  pages?: number;
}

export interface TransactionFilter {
  bridge?: string;
  asset?: string;
  status?: "pending" | "completed" | "failed";
  operationType?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface TransactionListResult<T> {
  transactions: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface AssetTransactionRow {
  id: string;
  bridge_name: string | null;
  asset_code: string;
  asset_issuer: string;
  transaction_hash: string;
  operation_id: string;
  operation_type: string;
  status: string;
  ledger: string | number | null;
  paging_token: string;
  source_account: string | null;
  from_address: string | null;
  to_address: string | null;
  amount: string;
  fee_charged: string;
  occurred_at: Date;
  raw_transaction: Record<string, unknown> | null;
  raw_operation: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface TransactionSyncState {
  asset_code: string;
  asset_issuer: string;
  last_paging_token: string | null;
  last_ledger: string | number | null;
  error_count: number;
  last_error: string | null;
  last_synced_at: Date | null;
}

interface PersistedTransaction {
  id: string;
  txHash: string;
  bridge: string;
  asset: string;
  amount: number;
  sourceChain: string;
  destinationChain: string;
  senderAddress: string;
  recipientAddress: string;
  status: "pending" | "completed" | "failed";
  fee: number;
  timestamp: string;
  confirmedAt: string | null;
  stellarTxHash: string | null;
  ethereumTxHash: string | null;
  blockNumber: number | null;
  operationType: string;
}

interface ParsedOperation {
  bridge_name: string | null;
  asset_code: string;
  asset_issuer: string;
  transaction_hash: string;
  operation_id: string;
  operation_type: string;
  status: "pending" | "completed" | "failed";
  ledger: number | null;
  paging_token: string;
  source_account: string | null;
  from_address: string | null;
  to_address: string | null;
  amount: string;
  fee_charged: string;
  occurred_at: Date;
  raw_transaction: Record<string, unknown> | null;
  raw_operation: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export class TransactionService {
  private readonly db = getDatabase();
  private readonly horizon = new StellarSdk.Horizon.Server(config.STELLAR_HORIZON_URL, {
    allowHttp: config.NODE_ENV === "development",
  });

  async fetchTransactionsByAsset(
    assetCode: string,
    assetIssuer: string,
    options: TransactionFetchOptions = {},
  ): Promise<{ fetched: number; stored: number; lastCursor: string | null }> {
    const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), DEFAULT_PAGE_SIZE);
    const maxPages = Math.max(options.maxPages ?? 1, 1);
    const allowedTypes = new Set((options.operationTypes ?? []).map((type) => type.toLowerCase()));
    const includeAllTypes = allowedTypes.size === 0;

    let cursor = options.cursor ?? (await this.getSavedCursor(assetCode, assetIssuer)) ?? "now";
    let fetched = 0;
    let stored = 0;
    let pagesRead = 0;
    let lastCursor: string | null = null;

    try {
      while (pagesRead < maxPages) {
        const asset = new StellarSdk.Asset(assetCode, assetIssuer);
        const requestBase = (this.horizon.payments() as unknown as {
          forAsset: (assetParam: StellarSdk.Asset) => {
            order: (value: HorizonOrder) => {
              limit: (value: number) => {
                call: () => Promise<{ records: Array<Record<string, unknown>> }>;
                cursor?: (value: string) => {
                  call: () => Promise<{ records: Array<Record<string, unknown>> }>;
                };
              };
            };
          };
        })
          .forAsset(asset)
          .order(options.order ?? "desc")
          .limit(pageSize);

        const requestBuilder = cursor && requestBase.cursor
          ? requestBase.cursor(cursor)
          : requestBase;

        const page = await requestBuilder.call();
        const records = page.records as Array<Record<string, unknown>>;
        if (!records.length) {
          break;
        }

        fetched += records.length;

        const parsed: ParsedOperation[] = records
          .filter((record) => {
            const operationType = String(record.type ?? "").toLowerCase();
            return includeAllTypes || allowedTypes.has(operationType);
          })
          .map((record) => this.parsePaymentRecord(record, assetCode, assetIssuer, options.bridgeName));

        if (parsed.length > 0) {
          await this.upsertTransactions(parsed);
          stored += parsed.length;
        }

        const newest = records[records.length - 1];
        const token = String(newest?.paging_token ?? "").trim();
        if (!token) {
          break;
        }

        cursor = token;
        lastCursor = token;
        pagesRead += 1;

        await this.sleep(HORIZON_REQUEST_DELAY_MS);

        if (records.length < pageSize) {
          break;
        }
      }

      await this.saveSyncState(assetCode, assetIssuer, {
        last_paging_token: lastCursor,
        error_count: 0,
        last_error: null,
      });

      return { fetched, stored, lastCursor };
    } catch (error) {
      const message = (error as Error).message ?? "unknown transaction fetch error";
      logger.error({ assetCode, assetIssuer, error }, "Failed to fetch transaction history from Horizon");
      await this.bumpSyncError(assetCode, assetIssuer, message);
      throw error;
    }
  }

  async backfillAssetTransactions(
    assetCode: string,
    assetIssuer: string,
    options: TransactionBackfillOptions = {},
  ): Promise<{ fetched: number; stored: number; lastCursor: string | null }> {
    return this.fetchTransactionsByAsset(assetCode, assetIssuer, {
      ...options,
      order: "asc",
      maxPages: options.pages ?? options.maxPages ?? 25,
      cursor: options.cursor ?? "",
    });
  }

  async detectNewTransactions(
    assetCode: string,
    assetIssuer: string,
    operationTypes?: string[],
  ): Promise<{ fetched: number; stored: number; lastCursor: string | null }> {
    const cursor = await this.getSavedCursor(assetCode, assetIssuer);
    return this.fetchTransactionsByAsset(assetCode, assetIssuer, {
      cursor: cursor ?? "now",
      order: "asc",
      maxPages: 3,
      operationTypes,
    });
  }

  async listTransactions(
    filters: TransactionFilter,
    page: number,
    pageSize: number,
  ): Promise<TransactionListResult<PersistedTransaction>> {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.min(Math.max(pageSize, 1), 100);
    const offset = (safePage - 1) * safePageSize;

    const query = this.db("asset_transactions");
    this.applyFilters(query, filters);

    const totalRow = await query.clone().count<{ count: string }>("id as count").first();
    const total = Number(totalRow?.count ?? 0);

    const rows = (await query
      .clone()
      .select<AssetTransactionRow[]>("*")
      .orderBy("occurred_at", "desc")
      .limit(safePageSize)
      .offset(offset)) as unknown as AssetTransactionRow[];

    return {
      transactions: rows.map((row) => this.mapRow(row)),
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(total / safePageSize)),
    };
  }

  async exportTransactionsCsv(filters: TransactionFilter): Promise<string> {
    const query = this.db("asset_transactions").select<AssetTransactionRow[]>("*").orderBy("occurred_at", "desc");
    this.applyFilters(query, filters);

    const rows = (await query) as unknown as AssetTransactionRow[];
    const header = [
      "id",
      "txHash",
      "bridge",
      "asset",
      "operationType",
      "status",
      "amount",
      "fee",
      "senderAddress",
      "recipientAddress",
      "timestamp",
    ];

    const csvRows = rows.map((row) => {
      const mapped = this.mapRow(row);
      return [
        mapped.id,
        mapped.txHash,
        mapped.bridge,
        mapped.asset,
        mapped.operationType,
        mapped.status,
        mapped.amount,
        mapped.fee,
        mapped.senderAddress,
        mapped.recipientAddress,
        mapped.timestamp,
      ]
        .map((value) => this.escapeCsv(String(value ?? "")))
        .join(",");
    });

    return [header.join(","), ...csvRows].join("\n");
  }

  async getSyncState(assetCode: string, assetIssuer: string): Promise<TransactionSyncState | null> {
    const state = await this.db("asset_transaction_sync_state")
      .select<TransactionSyncState[]>("*")
      .where({ asset_code: assetCode, asset_issuer: assetIssuer })
      .first();

    return state ?? null;
  }

  private parsePaymentRecord(
    operation: Record<string, unknown>,
    assetCode: string,
    assetIssuer: string,
    bridgeName?: string,
  ): ParsedOperation {
    const now = new Date();
    const transactionHash = String(operation.transaction_hash ?? "");
    const status = operation.transaction_successful === true ? "completed" : "failed";

    return {
      bridge_name: bridgeName ?? null,
      asset_code: assetCode,
      asset_issuer: assetIssuer,
      transaction_hash: transactionHash,
      operation_id: String(operation.id ?? transactionHash),
      operation_type: String(operation.type ?? "unknown"),
      status,
      ledger: operation.ledger ? Number(operation.ledger) : null,
      paging_token: String(operation.paging_token ?? ""),
      source_account: this.valueOrNull(operation.source_account),
      from_address: this.valueOrNull(operation.from),
      to_address: this.valueOrNull(operation.to),
      amount: String(operation.amount ?? "0"),
      fee_charged: "0",
      occurred_at: new Date(String(operation.created_at ?? now.toISOString())),
      raw_transaction: null,
      raw_operation: operation,
      created_at: now,
      updated_at: now,
    };
  }

  private async upsertTransactions(records: ParsedOperation[]): Promise<void> {
    for (let index = 0; index < records.length; index += 100) {
      const chunk = records.slice(index, index + 100);
      await this.db("asset_transactions")
        .insert(chunk)
        .onConflict("operation_id")
        .merge({
          status: this.db.raw("excluded.status"),
          bridge_name: this.db.raw("excluded.bridge_name"),
          fee_charged: this.db.raw("excluded.fee_charged"),
          raw_operation: this.db.raw("excluded.raw_operation"),
          updated_at: this.db.fn.now(),
        });
    }
  }

  private applyFilters(query: any, filters: TransactionFilter): void {
    if (filters.bridge) {
      query.where("bridge_name", filters.bridge);
    }
    if (filters.asset) {
      query.where("asset_code", filters.asset);
    }
    if (filters.status) {
      query.where("status", filters.status);
    }
    if (filters.operationType) {
      query.where("operation_type", filters.operationType);
    }
    if (filters.dateFrom) {
      query.where("occurred_at", ">=", new Date(filters.dateFrom));
    }
    if (filters.dateTo) {
      query.where("occurred_at", "<=", new Date(filters.dateTo));
    }
    if (filters.search) {
      const term = `%${filters.search.trim()}%`;
      query.andWhere((builder: any) => {
        builder
          .where("transaction_hash", "ilike", term)
          .orWhere("source_account", "ilike", term)
          .orWhere("from_address", "ilike", term)
          .orWhere("to_address", "ilike", term);
      });
    }
  }

  private mapRow(row: AssetTransactionRow): PersistedTransaction {
    return {
      id: row.id,
      txHash: row.transaction_hash,
      bridge: row.bridge_name ?? "stellar",
      asset: row.asset_code,
      amount: Number(row.amount),
      sourceChain: "stellar",
      destinationChain: "stellar",
      senderAddress: row.from_address ?? row.source_account ?? "",
      recipientAddress: row.to_address ?? "",
      status: this.normalizeStatus(row.status),
      fee: Number(row.fee_charged),
      timestamp: row.occurred_at.toISOString(),
      confirmedAt: row.status === "completed" ? row.occurred_at.toISOString() : null,
      stellarTxHash: row.transaction_hash,
      ethereumTxHash: null,
      blockNumber: row.ledger ? Number(row.ledger) : null,
      operationType: row.operation_type,
    };
  }

  private normalizeStatus(value: string): "pending" | "completed" | "failed" {
    if (value === "failed") return "failed";
    if (value === "pending") return "pending";
    return "completed";
  }

  private valueOrNull(value: unknown): string | null {
    if (typeof value !== "string") return null;
    return value.trim().length > 0 ? value : null;
  }

  private async getSavedCursor(assetCode: string, assetIssuer: string): Promise<string | null> {
    const state = await this.getSyncState(assetCode, assetIssuer);
    return state?.last_paging_token ?? null;
  }

  private async saveSyncState(
    assetCode: string,
    assetIssuer: string,
    update: Partial<Pick<TransactionSyncState, "last_paging_token" | "last_ledger" | "error_count" | "last_error">>,
  ): Promise<void> {
    await this.db("asset_transaction_sync_state")
      .insert({
        asset_code: assetCode,
        asset_issuer: assetIssuer,
        last_paging_token: update.last_paging_token ?? null,
        last_ledger: update.last_ledger ?? null,
        error_count: update.error_count ?? 0,
        last_error: update.last_error ?? null,
        last_synced_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict(["asset_code", "asset_issuer"])
      .merge({
        last_paging_token: update.last_paging_token ?? null,
        last_ledger: update.last_ledger ?? null,
        error_count: update.error_count ?? 0,
        last_error: update.last_error ?? null,
        last_synced_at: new Date(),
        updated_at: new Date(),
      });
  }

  private async bumpSyncError(assetCode: string, assetIssuer: string, message: string): Promise<void> {
    const existing = await this.getSyncState(assetCode, assetIssuer);
    const nextCount = (existing?.error_count ?? 0) + 1;
    await this.saveSyncState(assetCode, assetIssuer, {
      last_paging_token: existing?.last_paging_token ?? null,
      last_ledger: existing?.last_ledger ? Number(existing.last_ledger) : null,
      error_count: nextCount,
      last_error: message,
    });
  }

  private escapeCsv(value: string): string {
    if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
