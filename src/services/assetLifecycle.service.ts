import { getDatabase } from "../database/connection.js";
import { logger } from "../utils/logger.js";
import { AssetModel } from "../database/models/asset.model.js";

export interface AssetLifecycleEvent {
  id: string;
  assetSymbol: string;
  eventType: "deactivated" | "reactivated";
  reason?: string | null;
  performedBy: string;
  timestamp: Date;
}

export class AssetLifecycleService {
  private assetModel = new AssetModel();

  async deactivateAsset(
    symbol: string,
    reason: string | null,
    performedBy: string
  ): Promise<{ success: boolean; asset?: any; error?: string }> {
    const db = getDatabase();

    try {
      const existing = await this.assetModel.findBySymbol(symbol);

      if (!existing) {
        return { success: false, error: `Asset ${symbol} not found` };
      }

      if (!existing.is_active) {
        return { success: false, error: `Asset ${symbol} is already deactivated` };
      }

      await db.transaction(async (trx) => {
        await this.assetModel.deactivate(symbol, reason, performedBy);

        await trx("asset_lifecycle_events").insert({
          id: crypto.randomUUID(),
          asset_symbol: symbol,
          event_type: "deactivated",
          reason: reason || null,
          performed_by: performedBy,
          timestamp: new Date(),
        });
      });

      logger.info(
        { symbol, reason, performedBy },
        "Asset deactivated successfully"
      );

      return { success: true };
    } catch (error) {
      logger.error({ error, symbol }, "Failed to deactivate asset");
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async reactivateAsset(
    symbol: string,
    performedBy: string
  ): Promise<{ success: boolean; asset?: any; error?: string }> {
    const db = getDatabase();

    try {
      const existing = await this.assetModel.findBySymbol(symbol);

      if (!existing) {
        return { success: false, error: `Asset ${symbol} not found` };
      }

      if (existing.is_active) {
        return { success: false, error: `Asset ${symbol} is already active` };
      }

      await db.transaction(async (trx) => {
        await this.assetModel.reactivate(symbol, performedBy);

        await trx("asset_lifecycle_events").insert({
          id: crypto.randomUUID(),
          asset_symbol: symbol,
          event_type: "reactivated",
          reason: null,
          performed_by: performedBy,
          timestamp: new Date(),
        });
      });

      logger.info({ symbol, performedBy }, "Asset reactivated successfully");

      return { success: true };
    } catch (error) {
      logger.error({ error, symbol }, "Failed to reactivate asset");
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async getLifecycleEvents(symbol: string, limit = 50): Promise<AssetLifecycleEvent[]> {
    const db = getDatabase();

    try {
      const events = await db("asset_lifecycle_events")
        .where({ asset_symbol: symbol })
        .orderBy("timestamp", "desc")
        .limit(limit);

      return events.map((e: any) => ({
        id: e.id,
        assetSymbol: e.asset_symbol,
        eventType: e.event_type,
        reason: e.reason,
        performedBy: e.performed_by,
        timestamp: e.timestamp,
      }));
    } catch (error) {
      logger.error({ error, symbol }, "Failed to get lifecycle events");
      return [];
    }
  }

  async getDeactivatedAssets(): Promise<any[]> {
    const assets = await this.assetModel.getDeactivatedAssets();
    return assets.map((asset: any) => ({
      symbol: asset.symbol,
      name: asset.name,
      deactivationReason: asset.deactivation_reason,
      deactivationDate: asset.deactivation_date,
      createdAt: asset.created_at,
    }));
  }

  async validateDeactivation(symbol: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const existing = await this.assetModel.findBySymbol(symbol);

    if (!existing) {
      errors.push(`Asset ${symbol} not found`);
    }

    if (existing && !existing.is_active) {
      errors.push(`Asset ${symbol} is already deactivated`);
    }

    return { valid: errors.length === 0, errors };
  }
}

export const assetLifecycleService = new AssetLifecycleService();
