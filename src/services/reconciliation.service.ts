import { getDatabase } from "../database/connection.js";
import type { ReconciliationStatus } from "../database/types.js";

export type ReconciliationTriageStatus =
  | "open"
  | "investigating"
  | "acknowledged"
  | "resolved"
  | "false_positive";

export type DriftSeverity = "aligned" | "low" | "medium" | "high" | "critical";
export type DriftTrendDirection = "new" | "improving" | "worsening" | "flat";
export type ReconciliationRange = "24h" | "7d" | "30d" | "90d";

export interface CreateReconciliationRunInput {
  assetCode: string;
  jobId?: string | null;
  attempt?: number;
  bridgeName?: string | null;
  sourceChain?: string | null;
  onChainSource?: Record<string, unknown> | null;
  reserveAttestation?: Record<string, unknown> | null;
  reportedBacking?: Record<string, unknown> | null;
}

export interface FinishReconciliationRunInput {
  id: string;
  status: Exclude<ReconciliationStatus, "running">;
  stellarSupply?: number | null;
  reportedSupply?: number | null;
  mismatchPercentage?: number | null;
  error?: string | null;
  onChainSource?: Record<string, unknown> | null;
  reserveAttestation?: Record<string, unknown> | null;
  reportedBacking?: Record<string, unknown> | null;
}

export interface DriftSummaryFilters {
  assetCode?: string;
  bridge?: string;
  range?: ReconciliationRange;
  startDate?: string;
  endDate?: string;
}

export interface ReconciliationRunDto {
  id: string;
  assetCode: string;
  bridgeName: string;
  sourceChain: string | null;
  status: ReconciliationStatus;
  triageStatus: ReconciliationTriageStatus;
  triageOwner: string | null;
  triageNote: string | null;
  triagedAt: string | null;
  stellarSupply: number | null;
  reportedSupply: number | null;
  mismatchPercentage: number | null;
  discrepancy: number | null;
  discrepancyAbs: number | null;
  severity: DriftSeverity;
  startedAt: string;
  finishedAt: string | null;
  attempt: number;
  jobId: string | null;
  error: string | null;
  sourceData: ReconciliationSourceDatum[];
}

export interface ReconciliationSourceDatum {
  id: "on-chain" | "reserve-attestation" | "reported-backing";
  label: string;
  source: string;
  value: number | null;
  unit: string;
  observedAt: string | null;
  status: string;
  reference: string | null;
  details: Record<string, string | number | boolean | null>;
}

export interface DriftSummary {
  id: string;
  assetCode: string;
  bridgeName: string;
  sourceChain: string | null;
  latestRun: ReconciliationRunDto;
  previousRunId: string | null;
  severity: DriftSeverity;
  trendDirection: DriftTrendDirection;
  unresolved: boolean;
  mismatchDelta: number | null;
  runCount: number;
  mismatchRunCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  history: Array<{
    id: string;
    startedAt: string;
    mismatchPercentage: number | null;
    status: ReconciliationStatus;
    triageStatus: ReconciliationTriageStatus;
  }>;
}

interface ReconciliationRunRow {
  started_at: Date | string;
  id: string;
  asset_code: string;
  job_id: string | null;
  bridge_name?: string | null;
  source_chain?: string | null;
  status: ReconciliationStatus;
  stellar_supply: string | number | null;
  reported_supply: string | number | null;
  mismatch_percentage: string | number | null;
  attempt: number;
  error: string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  on_chain_source?: unknown;
  reserve_attestation?: unknown;
  reported_backing?: unknown;
  triage_status?: ReconciliationTriageStatus | null;
  triage_owner?: string | null;
  triage_note?: string | null;
  triaged_at?: Date | string | null;
}

interface AssetMetadataRow {
  symbol: string;
  issuer: string | null;
  bridge_provider: string | null;
  source_chain: string | null;
}

interface BridgeMetadataRow {
  name: string;
  source_chain: string | null;
}

interface ReserveCommitmentRow {
  bridge_id: string;
  sequence: string | number;
  merkle_root: string;
  total_reserves: string | number;
  status: string;
  tx_hash: string | null;
  committed_at: string | number;
  committed_ledger: number;
  updated_at: Date | string;
}

interface MetadataContext {
  assets: Map<string, AssetMetadataRow>;
  bridges: BridgeMetadataRow[];
}

const RANGE_DAYS: Record<ReconciliationRange, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const SEVERITY_RANK: Record<DriftSeverity, number> = {
  aligned: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const CLOSED_TRIAGE_STATUSES = new Set<ReconciliationTriageStatus>([
  "resolved",
  "false_positive",
]);

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeJsonObject(parsed);
    } catch {
      return {};
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function toSourceDetails(value: unknown): Record<string, string | number | boolean | null> {
  const normalized = normalizeJsonObject(value);
  return Object.fromEntries(
    Object.entries(normalized)
      .filter(([, item]) => {
        const type = typeof item;
        return item === null || type === "string" || type === "number" || type === "boolean";
      })
      .map(([key, item]) => [key, item as string | number | boolean | null])
  );
}

function normalizeText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export class ReconciliationService {
  private readonly db = getDatabase();

  async startRun(input: CreateReconciliationRunInput): Promise<{ id: string }> {
    const defaults = await this.getDefaultRunMetadata(input.assetCode);
    const [row] = await this.db("reconciliation_runs")
      .insert({
        started_at: new Date(),
        asset_code: input.assetCode,
        job_id: input.jobId ?? null,
        bridge_name: input.bridgeName ?? defaults.bridgeName,
        source_chain: input.sourceChain ?? defaults.sourceChain,
        on_chain_source: input.onChainSource ?? null,
        reserve_attestation: input.reserveAttestation ?? null,
        reported_backing: input.reportedBacking ?? null,
        status: "running",
        attempt: input.attempt ?? 1,
      })
      .returning<{ id: string }[]>("id");

    return { id: row?.id ?? "" };
  }

  async finishRun(input: FinishReconciliationRunInput): Promise<void> {
    const update: Record<string, unknown> = {
      status: input.status,
      stellar_supply: input.stellarSupply ?? null,
      reported_supply: input.reportedSupply ?? null,
      mismatch_percentage: input.mismatchPercentage ?? null,
      error: input.error ?? null,
      finished_at: new Date(),
      updated_at: new Date(),
    };

    if (input.onChainSource !== undefined) update.on_chain_source = input.onChainSource;
    if (input.reserveAttestation !== undefined) {
      update.reserve_attestation = input.reserveAttestation;
    }
    if (input.reportedBacking !== undefined) update.reported_backing = input.reportedBacking;

    await this.db("reconciliation_runs")
      .where({ id: input.id })
      .update(update);
  }

  async listRuns(params: { assetCode?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
    const q = this.db("reconciliation_runs")
      .orderBy("started_at", "desc")
      .limit(limit);

    if (params.assetCode) q.where({ asset_code: params.assetCode });
    return q;
  }

  async getLatestRun(assetCode: string) {
    return this.db("reconciliation_runs")
      .where({ asset_code: assetCode })
      .orderBy("started_at", "desc")
      .first();
  }

  async getDriftSummaries(filters: DriftSummaryFilters = {}) {
    const rows = await this.queryRuns(filters, 1500);
    const context = await this.loadMetadataContext();

    const bridgeFilter = normalizeText(filters.bridge)?.toLowerCase();
    const runs = rows
      .map((row) => this.serializeRun(row, context))
      .filter((run) =>
        bridgeFilter ? run.bridgeName.toLowerCase().includes(bridgeFilter) : true
      );

    const grouped = new Map<string, ReconciliationRunDto[]>();
    for (const run of runs) {
      const key = `${run.assetCode}::${run.bridgeName}`;
      const current = grouped.get(key) ?? [];
      current.push(run);
      grouped.set(key, current);
    }

    const summaries = Array.from(grouped.values())
      .map((groupRuns) => this.buildSummary(groupRuns))
      .sort((a, b) => {
        if (a.unresolved !== b.unresolved) return a.unresolved ? -1 : 1;
        const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (severityDelta !== 0) return severityDelta;
        return (
          (b.latestRun.discrepancyAbs ?? 0) - (a.latestRun.discrepancyAbs ?? 0)
        );
      });

    const assets = Array.from(
      new Set([
        ...Array.from(context.assets.keys()),
        ...runs.map((run) => run.assetCode),
      ])
    ).sort();

    const bridges = Array.from(
      new Set([
        ...context.bridges.map((bridge) => bridge.name),
        ...runs.map((run) => run.bridgeName),
      ])
    ).sort();

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        assetCode: filters.assetCode ?? null,
        bridge: filters.bridge ?? null,
        range: filters.range ?? "7d",
        startDate: filters.startDate ?? null,
        endDate: filters.endDate ?? null,
      },
      totals: {
        summaries: summaries.length,
        unresolved: summaries.filter((summary) => summary.unresolved).length,
        critical: summaries.filter((summary) => summary.severity === "critical").length,
        mismatchRuns: runs.filter((run) => run.status === "mismatch").length,
      },
      availableFilters: {
        assets,
        bridges,
        ranges: Object.keys(RANGE_DAYS) as ReconciliationRange[],
      },
      summaries,
    };
  }

  async getMismatchDetail(id: string, filters: Pick<DriftSummaryFilters, "range"> = {}) {
    const row = await this.db<ReconciliationRunRow>("reconciliation_runs")
      .where({ id })
      .first();

    if (!row) return null;

    const context = await this.loadMetadataContext();
    const run = this.serializeRun(row, context);
    const historyRows = await this.queryRuns(
      {
        assetCode: run.assetCode,
        range: filters.range ?? "30d",
      },
      100
    );
    const history = historyRows
      .map((historyRow) => this.serializeRun(historyRow, context))
      .filter((historyRun) => historyRun.bridgeName === run.bridgeName);

    const reserveCommitment = await this.getLatestReserveCommitment(run.assetCode);

    return {
      generatedAt: new Date().toISOString(),
      mismatch: {
        ...run,
        sourceData: this.buildSourceData(row, context, reserveCommitment),
      },
      history,
      sourceData: this.buildSourceData(row, context, reserveCommitment),
      reserveCommitment: reserveCommitment
        ? {
            bridgeId: reserveCommitment.bridge_id,
            sequence: toNumber(reserveCommitment.sequence),
            merkleRoot: reserveCommitment.merkle_root,
            totalReserves: toNumber(reserveCommitment.total_reserves),
            status: reserveCommitment.status,
            txHash: reserveCommitment.tx_hash,
            committedAt: reserveCommitment.committed_at,
            committedLedger: reserveCommitment.committed_ledger,
            updatedAt: toIso(reserveCommitment.updated_at),
          }
        : null,
    };
  }

  async updateTriageStatus(
    id: string,
    input: {
      status: ReconciliationTriageStatus;
      owner?: string | null;
      note?: string | null;
    }
  ): Promise<ReconciliationRunDto | null> {
    const update: Record<string, unknown> = {
      triage_status: input.status,
      triaged_at: new Date(),
      updated_at: new Date(),
    };

    if (input.owner !== undefined) update.triage_owner = normalizeText(input.owner) ?? null;
    if (input.note !== undefined) update.triage_note = normalizeText(input.note) ?? null;

    const [row] = await this.db("reconciliation_runs")
      .where({ id })
      .update(update)
      .returning<ReconciliationRunRow[]>("*");

    if (!row) return null;
    const context = await this.loadMetadataContext();
    return this.serializeRun(row, context);
  }

  private async queryRuns(filters: DriftSummaryFilters, limit: number): Promise<ReconciliationRunRow[]> {
    const q = this.db<ReconciliationRunRow>("reconciliation_runs").orderBy(
      "started_at",
      "desc"
    );

    if (filters.assetCode) q.where({ asset_code: filters.assetCode });

    const { startDate, endDate } = this.resolveDateWindow(filters);
    if (startDate) q.andWhere("started_at", ">=", startDate);
    if (endDate) q.andWhere("started_at", "<=", endDate);

    return q.limit(limit);
  }

  private resolveDateWindow(filters: DriftSummaryFilters) {
    const endDate = filters.endDate ? new Date(filters.endDate) : new Date();
    const hasValidEnd = !Number.isNaN(endDate.getTime());
    const normalizedEnd = hasValidEnd ? endDate : new Date();

    if (filters.startDate) {
      const startDate = new Date(filters.startDate);
      return {
        startDate: Number.isNaN(startDate.getTime()) ? undefined : startDate,
        endDate: normalizedEnd,
      };
    }

    const range = filters.range ?? "7d";
    const days = RANGE_DAYS[range] ?? RANGE_DAYS["7d"];
    const startDate = new Date(normalizedEnd);
    startDate.setDate(startDate.getDate() - days);
    return { startDate, endDate: normalizedEnd };
  }

  private buildSummary(groupRuns: ReconciliationRunDto[]): DriftSummary {
    const sorted = [...groupRuns].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    const latestRun = sorted[0];
    const previousRun = sorted[1] ?? null;
    const mismatchDelta =
      latestRun.mismatchPercentage !== null && previousRun?.mismatchPercentage !== null
        ? latestRun.mismatchPercentage - previousRun.mismatchPercentage
        : null;

    const unresolved =
      latestRun.status !== "success" && !CLOSED_TRIAGE_STATUSES.has(latestRun.triageStatus);

    return {
      id: `${latestRun.assetCode}:${latestRun.bridgeName}`,
      assetCode: latestRun.assetCode,
      bridgeName: latestRun.bridgeName,
      sourceChain: latestRun.sourceChain,
      latestRun,
      previousRunId: previousRun?.id ?? null,
      severity: latestRun.severity,
      trendDirection: this.getTrendDirection(latestRun, previousRun),
      unresolved,
      mismatchDelta,
      runCount: sorted.length,
      mismatchRunCount: sorted.filter((run) => run.status === "mismatch").length,
      firstSeenAt: sorted[sorted.length - 1]?.startedAt ?? latestRun.startedAt,
      lastSeenAt: latestRun.startedAt,
      history: sorted
        .slice(0, 30)
        .reverse()
        .map((run) => ({
          id: run.id,
          startedAt: run.startedAt,
          mismatchPercentage: run.mismatchPercentage,
          status: run.status,
          triageStatus: run.triageStatus,
        })),
    };
  }

  private serializeRun(
    row: ReconciliationRunRow,
    context: MetadataContext
  ): ReconciliationRunDto {
    const stellarSupply = toNumber(row.stellar_supply);
    const reportedSupply = toNumber(row.reported_supply);
    const mismatchPercentage = toNumber(row.mismatch_percentage);
    const discrepancy =
      stellarSupply !== null && reportedSupply !== null ? stellarSupply - reportedSupply : null;
    const bridgeName = this.inferBridgeName(row.asset_code, row, context);
    const sourceChain = row.source_chain ?? context.assets.get(row.asset_code)?.source_chain ?? null;

    return {
      id: row.id,
      assetCode: row.asset_code,
      bridgeName,
      sourceChain,
      status: row.status,
      triageStatus: this.resolveTriageStatus(row),
      triageOwner: row.triage_owner ?? null,
      triageNote: row.triage_note ?? null,
      triagedAt: toIso(row.triaged_at),
      stellarSupply,
      reportedSupply,
      mismatchPercentage,
      discrepancy,
      discrepancyAbs: discrepancy === null ? null : Math.abs(discrepancy),
      severity: this.getSeverity(row.status, mismatchPercentage),
      startedAt: toIso(row.started_at) ?? new Date(0).toISOString(),
      finishedAt: toIso(row.finished_at),
      attempt: row.attempt,
      jobId: row.job_id,
      error: row.error,
      sourceData: this.buildSourceData(row, context),
    };
  }

  private buildSourceData(
    row: ReconciliationRunRow,
    context: MetadataContext,
    reserveCommitment?: ReserveCommitmentRow | null
  ): ReconciliationSourceDatum[] {
    const asset = context.assets.get(row.asset_code);
    const bridgeName = this.inferBridgeName(row.asset_code, row, context);
    const sourceChain = row.source_chain ?? asset?.source_chain ?? "Source chain";
    const onChainDetails = toSourceDetails(row.on_chain_source);
    const attestationDetails = toSourceDetails(row.reserve_attestation);
    const backingDetails = toSourceDetails(row.reported_backing);
    const reserveValue =
      reserveCommitment?.total_reserves !== undefined
        ? toNumber(reserveCommitment.total_reserves)
        : toNumber(row.reported_supply);

    return [
      {
        id: "on-chain",
        label: "On-chain supply",
        source: "Stellar ledger",
        value: toNumber(row.stellar_supply),
        unit: row.asset_code,
        observedAt: toIso(row.started_at),
        status: row.status,
        reference: asset?.issuer ?? bridgeName,
        details: {
          ledger: onChainDetails.ledger ?? null,
          account: onChainDetails.account ?? null,
          bridge: bridgeName,
        },
      },
      {
        id: "reserve-attestation",
        label: "Reserve attestation",
        source: "Reserve commitment",
        value: reserveValue,
        unit: row.asset_code,
        observedAt: reserveCommitment
          ? toIso(reserveCommitment.updated_at)
          : toIso(row.finished_at ?? row.started_at),
        status: reserveCommitment?.status ?? String(attestationDetails.status ?? "not_recorded"),
        reference:
          reserveCommitment?.tx_hash ??
          (reserveCommitment?.sequence !== undefined
            ? `sequence ${reserveCommitment.sequence}`
            : String(attestationDetails.reference ?? "pending")),
        details: {
          bridgeId: reserveCommitment?.bridge_id ?? String(attestationDetails.bridgeId ?? bridgeName),
          merkleRoot: reserveCommitment?.merkle_root ?? String(attestationDetails.merkleRoot ?? ""),
          sequence: reserveCommitment ? Number(reserveCommitment.sequence) : null,
          committedLedger: reserveCommitment?.committed_ledger ?? null,
        },
      },
      {
        id: "reported-backing",
        label: "Reported backing",
        source: `${sourceChain} reserve balance`,
        value: toNumber(row.reported_supply),
        unit: row.asset_code,
        observedAt: toIso(row.finished_at ?? row.started_at),
        status: row.status === "failed" ? "unavailable" : "reported",
        reference: String(backingDetails.reference ?? bridgeName),
        details: {
          bridge: bridgeName,
          sourceChain,
          provider: asset?.bridge_provider ?? null,
        },
      },
    ];
  }

  private async getDefaultRunMetadata(assetCode: string) {
    try {
      const asset = await this.db<AssetMetadataRow>("assets")
        .where({ symbol: assetCode })
        .select("symbol", "bridge_provider", "source_chain", "issuer")
        .first();

      return {
        bridgeName: asset?.bridge_provider
          ? `${asset.bridge_provider} ${assetCode} Bridge`
          : null,
        sourceChain: asset?.source_chain ?? null,
      };
    } catch {
      return { bridgeName: null, sourceChain: null };
    }
  }

  private async loadMetadataContext(): Promise<MetadataContext> {
    const [assetRows, bridgeRows] = await Promise.all([
      this.db<AssetMetadataRow>("assets")
        .select("symbol", "issuer", "bridge_provider", "source_chain")
        .catch(() => [] as AssetMetadataRow[]),
      this.db<BridgeMetadataRow>("bridges")
        .select("name", "source_chain")
        .catch(() => [] as BridgeMetadataRow[]),
    ]);

    return {
      assets: new Map(assetRows.map((asset) => [asset.symbol, asset])),
      bridges: bridgeRows,
    };
  }

  private async getLatestReserveCommitment(
    assetCode: string
  ): Promise<ReserveCommitmentRow | null> {
    try {
      const operator = await this.db("bridge_operators")
        .where({ asset_code: assetCode, is_active: true })
        .select("bridge_id")
        .first();

      if (!operator?.bridge_id) return null;

      const row = await this.db<ReserveCommitmentRow>("reserve_commitments")
        .where({ bridge_id: operator.bridge_id })
        .orderBy("sequence", "desc")
        .first();

      return row ?? null;
    } catch {
      return null;
    }
  }

  private inferBridgeName(
    assetCode: string,
    row: Pick<ReconciliationRunRow, "bridge_name">,
    context: MetadataContext
  ): string {
    if (row.bridge_name) return row.bridge_name;

    const matchingBridge = context.bridges.find((bridge) =>
      bridge.name.toLowerCase().includes(assetCode.toLowerCase())
    );
    if (matchingBridge) return matchingBridge.name;

    const asset = context.assets.get(assetCode);
    if (asset?.bridge_provider) return `${asset.bridge_provider} ${assetCode} Bridge`;

    return "Unassigned bridge";
  }

  private resolveTriageStatus(row: ReconciliationRunRow): ReconciliationTriageStatus {
    if (row.triage_status) return row.triage_status;
    return row.status === "success" ? "resolved" : "open";
  }

  private getSeverity(
    status: ReconciliationStatus,
    mismatchPercentage: number | null
  ): DriftSeverity {
    if (status === "failed") return "high";
    if (mismatchPercentage === null) return status === "running" ? "low" : "aligned";
    if (mismatchPercentage <= 0.1) return "aligned";
    if (mismatchPercentage <= 0.5) return "low";
    if (mismatchPercentage <= 1) return "medium";
    if (mismatchPercentage <= 5) return "high";
    return "critical";
  }

  private getTrendDirection(
    latestRun: ReconciliationRunDto,
    previousRun: ReconciliationRunDto | null
  ): DriftTrendDirection {
    if (!previousRun) return "new";
    if (
      latestRun.mismatchPercentage === null ||
      previousRun.mismatchPercentage === null
    ) {
      return "flat";
    }

    const delta = latestRun.mismatchPercentage - previousRun.mismatchPercentage;
    if (Math.abs(delta) < 0.01) return "flat";
    return delta < 0 ? "improving" : "worsening";
  }
}
