import { getDatabase } from "../database/connection.js";
import type { ReconciliationStatus } from "../database/types.js";

export interface CreateReconciliationRunInput {
  assetCode: string;
  jobId?: string | null;
  attempt?: number;
}

export interface FinishReconciliationRunInput {
  id: string;
  status: Exclude<ReconciliationStatus, "running">;
  stellarSupply?: number | null;
  reportedSupply?: number | null;
  mismatchPercentage?: number | null;
  error?: string | null;
}

export class ReconciliationService {
  private readonly db = getDatabase();

  async startRun(input: CreateReconciliationRunInput): Promise<{ id: string }> {
    const [row] = await this.db("reconciliation_runs")
      .insert({
        started_at: new Date(),
        asset_code: input.assetCode,
        job_id: input.jobId ?? null,
        status: "running",
        attempt: input.attempt ?? 1,
      })
      .returning<{ id: string }[]>("id");

    return { id: row?.id ?? "" };
  }

  async finishRun(input: FinishReconciliationRunInput): Promise<void> {
    await this.db("reconciliation_runs")
      .where({ id: input.id })
      .update({
        status: input.status,
        stellar_supply: input.stellarSupply ?? null,
        reported_supply: input.reportedSupply ?? null,
        mismatch_percentage: input.mismatchPercentage ?? null,
        error: input.error ?? null,
        finished_at: new Date(),
        updated_at: new Date(),
      });
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
}

