import crypto from "crypto";
import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";

export interface DuplicateGroup {
  primaryAssetId: string;
  primarySymbol: string;
  duplicateIds: string[];
  matchScore: number;
  matchReason: string;
}

export interface MergeResult {
  id: string;
  primaryAssetId: string;
  primarySymbol: string;
  mergedAssetIds: string[];
  mergeRulesApplied: Record<string, unknown>;
  conflictsResolved: ConflictResolution[];
  status: string;
  triggeredBy: string;
  createdAt: string;
}

export interface ConflictResolution {
  field: string;
  chosen: unknown;
  alternatives: unknown[];
  reason: string;
}

export interface MergeReview {
  id: string;
  duplicateGroup: DuplicateGroup;
  suggestedMerge: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewNotes: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

const MERGE_RULES = {
  scoreThreshold: 0.8,
  retainFields: ["symbol", "name", "issuer"] as string[],
  preferenceOrder: ["source_chain", "bridge_provider"] as string[],
};

export class AssetMergeService {
  private static instance: AssetMergeService;

  private constructor() {}

  public static getInstance(): AssetMergeService {
    if (!AssetMergeService.instance) {
      AssetMergeService.instance = new AssetMergeService();
    }
    return AssetMergeService.instance;
  }

  public async findDuplicates(): Promise<DuplicateGroup[]> {
    const db = getDatabase();
    const assets = await db("assets").where("is_active", true).orderBy("symbol");

    const groups: DuplicateGroup[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < assets.length; i++) {
      if (seen.has(assets[i].id)) continue;

      const group: DuplicateGroup = {
        primaryAssetId: assets[i].id,
        primarySymbol: assets[i].symbol,
        duplicateIds: [],
        matchScore: 0,
        matchReason: "",
      };

      for (let j = i + 1; j < assets.length; j++) {
        if (seen.has(assets[j].id)) continue;

        const score = this.computeMatchScore(assets[i], assets[j]);
        if (score >= MERGE_RULES.scoreThreshold) {
          group.duplicateIds.push(assets[j].id);
          group.matchScore = Math.max(group.matchScore, score);
          group.matchReason = this.determineMatchReason(assets[i], assets[j]);
          seen.add(assets[j].id);
        }
      }

      if (group.duplicateIds.length > 0) {
        seen.add(assets[i].id);
        groups.push(group);
      }
    }

    return groups;
  }

  public async merge(
    primaryAssetId: string,
    duplicateIds: string[],
    triggeredBy: string
  ): Promise<MergeResult> {
    const db = getDatabase();
    const primary = await db("assets").where("id", primaryAssetId).first();
    if (!primary) throw new Error(`Primary asset not found: ${primaryAssetId}`);

    const duplicates = await db("assets").whereIn("id", duplicateIds);
    if (duplicates.length !== duplicateIds.length) {
      throw new Error("One or more duplicate assets not found");
    }

    const conflictsResolved: ConflictResolution[] = [];
    const mergeRulesApplied: Record<string, unknown> = {
      scoreThreshold: MERGE_RULES.scoreThreshold,
      retainFields: MERGE_RULES.retainFields,
      preferenceOrder: MERGE_RULES.preferenceOrder,
    };

    for (const dup of duplicates) {
      for (const field of MERGE_RULES.retainFields) {
        if (!primary[field] && dup[field]) {
          conflictsResolved.push({
            field,
            chosen: dup[field],
            alternatives: [primary[field]],
            reason: `Primary had no ${field}, using from duplicate`,
          });
        }
      }
    }

    const mergedData: Record<string, unknown> = { updated_at: new Date() };
    for (const resolution of conflictsResolved) {
      mergedData[resolution.field] = resolution.chosen;
    }

    if (Object.keys(mergedData).length > 1) {
      await db("assets").where("id", primaryAssetId).update(mergedData);
    }

    await db("assets").whereIn("id", duplicateIds).update({ is_active: false });

    const id = crypto.randomUUID();
    await db("asset_merge_logs").insert({
      id,
      primary_asset_id: primaryAssetId,
      primary_symbol: primary.symbol,
      merged_asset_ids: JSON.stringify(duplicateIds),
      merge_rules_applied: JSON.stringify(mergeRulesApplied),
      conflicts_resolved: JSON.stringify(conflictsResolved),
      status: "completed",
      triggered_by: triggeredBy,
      created_at: new Date(),
    });

    logger.info(
      { primaryAssetId, duplicateCount: duplicateIds.length },
      "Assets merged successfully"
    );

    return {
      id,
      primaryAssetId,
      primarySymbol: primary.symbol,
      mergedAssetIds: duplicateIds,
      mergeRulesApplied,
      conflictsResolved,
      status: "completed",
      triggeredBy,
      createdAt: new Date().toISOString(),
    };
  }

  public async proposeMerge(
    duplicateGroup: DuplicateGroup
  ): Promise<MergeReview> {
    const db = getDatabase();
    const suggestedMerge: Record<string, unknown> = {
      primaryAssetId: duplicateGroup.primaryAssetId,
      primarySymbol: duplicateGroup.primarySymbol,
      duplicates: duplicateGroup.duplicateIds,
      matchScore: duplicateGroup.matchScore,
      matchReason: duplicateGroup.matchReason,
    };

    const id = crypto.randomUUID();
    await db("asset_merge_reviews").insert({
      id,
      duplicate_group: JSON.stringify(duplicateGroup),
      suggested_merge: JSON.stringify(suggestedMerge),
      status: "pending",
      reviewed_by: null,
      review_notes: null,
      reviewed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    return {
      id,
      duplicateGroup,
      suggestedMerge,
      status: "pending",
      reviewedBy: null,
      reviewNotes: null,
      reviewedAt: null,
      createdAt: new Date(),
    };
  }

  public async reviewMerge(
    reviewId: string,
    status: "approved" | "rejected",
    reviewedBy: string,
    reviewNotes?: string
  ): Promise<MergeReview | null> {
    const db = getDatabase();
    const existing = await db("asset_merge_reviews").where("id", reviewId).first();
    if (!existing) return null;

    await db("asset_merge_reviews")
      .where("id", reviewId)
      .update({
        status,
        reviewed_by: reviewedBy,
        review_notes: reviewNotes ?? null,
        reviewed_at: new Date(),
        updated_at: new Date(),
      });

    if (status === "approved") {
      const group = JSON.parse(
        typeof existing.duplicate_group === "string"
          ? existing.duplicate_group
          : JSON.stringify(existing.duplicate_group)
      ) as DuplicateGroup;
      await this.merge(group.primaryAssetId, group.duplicateIds, reviewedBy);
    }

    return this.getReview(reviewId);
  }

  public async getReview(reviewId: string): Promise<MergeReview | null> {
    const db = getDatabase();
    const row = await db("asset_merge_reviews").where("id", reviewId).first();
    if (!row) return null;

    return {
      id: row.id as string,
      duplicateGroup:
        typeof row.duplicate_group === "string"
          ? JSON.parse(row.duplicate_group)
          : row.duplicate_group,
      suggestedMerge:
        typeof row.suggested_merge === "string"
          ? JSON.parse(row.suggested_merge)
          : row.suggested_merge,
      status: row.status as MergeReview["status"],
      reviewedBy: (row.reviewed_by as string) ?? null,
      reviewNotes: (row.review_notes as string) ?? null,
      reviewedAt: (row.reviewed_at as Date) ?? null,
      createdAt: row.created_at as Date,
    };
  }

  public async listReviews(params: {
    status?: string;
  } = {}): Promise<MergeReview[]> {
    const db = getDatabase();
    let query = db("asset_merge_reviews").orderBy("created_at", "desc");
    if (params.status) query = query.where("status", params.status);
    const rows = await query;
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      duplicateGroup:
        typeof r.duplicate_group === "string"
          ? JSON.parse(r.duplicate_group)
          : r.duplicate_group,
      suggestedMerge:
        typeof r.suggested_merge === "string"
          ? JSON.parse(r.suggested_merge)
          : r.suggested_merge,
      status: r.status as MergeReview["status"],
      reviewedBy: (r.reviewed_by as string) ?? null,
      reviewNotes: (r.review_notes as string) ?? null,
      reviewedAt: (r.reviewed_at as Date) ?? null,
      createdAt: r.created_at as Date,
    }));
  }

  public async getMergeHistory(params: {
    primaryAssetId?: string;
    limit?: number;
  } = {}): Promise<MergeResult[]> {
    const db = getDatabase();
    let query = db("asset_merge_logs").orderBy("created_at", "desc");
    if (params.primaryAssetId) query = query.where("primary_asset_id", params.primaryAssetId);
    if (params.limit) query = query.limit(params.limit);
    const rows = await query;
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      primaryAssetId: r.primary_asset_id as string,
      primarySymbol: r.primary_symbol as string,
      mergedAssetIds: JSON.parse(
        typeof r.merged_asset_ids === "string"
          ? (r.merged_asset_ids as string)
          : JSON.stringify(r.merged_asset_ids)
      ),
      mergeRulesApplied: JSON.parse(
        typeof r.merge_rules_applied === "string"
          ? (r.merge_rules_applied as string)
          : JSON.stringify(r.merge_rules_applied)
      ),
      conflictsResolved: JSON.parse(
        typeof r.conflicts_resolved === "string"
          ? (r.conflicts_resolved as string)
          : JSON.stringify(r.conflicts_resolved)
      ),
      status: r.status as string,
      triggeredBy: r.triggered_by as string,
      createdAt: (r.created_at as Date).toISOString(),
    }));
  }

  private computeMatchScore(a: Record<string, unknown>, b: Record<string, unknown>): number {
    let score = 0;
    let total = 0;

    if (a.symbol === b.symbol) { score += 30; total += 30; }
    if (a.name === b.name) { score += 25; total += 25; }
    if (a.issuer === b.issuer && a.issuer) { score += 25; total += 25; }
    if (a.source_chain === b.source_chain && a.source_chain) { score += 10; total += 10; }
    if (a.bridge_provider === b.bridge_provider && a.bridge_provider) { score += 10; total += 10; }

    return total > 0 ? score / total : 0;
  }

  private determineMatchReason(
    a: Record<string, unknown>,
    b: Record<string, unknown>
  ): string {
    const reasons: string[] = [];
    if (a.symbol === b.symbol) reasons.push("same symbol");
    if (a.name === b.name) reasons.push("same name");
    if (a.issuer === b.issuer) reasons.push("same issuer");
    return reasons.length > 0 ? reasons.join(", ") : "unknown";
  }
}

export const assetMergeService = AssetMergeService.getInstance();
