/**
 * Asset Metadata Management Service
 * Manages asset metadata including logos, descriptions, links, and additional information
 */

import { getDatabase } from "../database/connection";
import { logger } from "../utils/logger";
import { randomBytes } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AssetMetadata {
  id: string;
  asset_id: string;
  symbol: string;
  logo_url: string | null;
  description: string | null;
  website_url: string | null;
  contract_address: string | null;
  social_links: SocialLinks;
  documentation_url: string | null;
  token_specifications: TokenSpecifications;
  category: string | null;
  tags: string[];
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface SocialLinks {
  twitter?: string;
  telegram?: string;
  discord?: string;
  github?: string;
  medium?: string;
}

export interface TokenSpecifications {
  decimals?: number;
  total_supply?: string;
  max_supply?: string;
  circulating_supply?: string;
  token_type?: string;
  standard?: string;
}

export interface MetadataVersion {
  id: string;
  metadata_id: string;
  version: number;
  changes: Record<string, unknown>;
  changed_by: string;
  timestamp: Date;
}

// ─── Asset Metadata Service ──────────────────────────────────────────────────

export class AssetMetadataService {
  /**
   * Get metadata for an asset
   */
  async getMetadata(assetId: string): Promise<AssetMetadata | null> {
    const db = getDatabase();

    try {
      const metadata = await db("asset_metadata")
        .where({ asset_id: assetId })
        .first();

      if (!metadata) {
        return null;
      }

      return {
        ...metadata,
        social_links: JSON.parse(metadata.social_links || "{}"),
        token_specifications: JSON.parse(metadata.token_specifications || "{}"),
        tags: JSON.parse(metadata.tags || "[]"),
      };
    } catch (error) {
      logger.error({ error, assetId }, "Failed to get asset metadata");
      return null;
    }
  }

  /**
   * Get metadata by symbol
   */
  async getMetadataBySymbol(symbol: string): Promise<AssetMetadata | null> {
    const db = getDatabase();

    try {
      const metadata = await db("asset_metadata").where({ symbol }).first();

      if (!metadata) {
        return null;
      }

      return {
        ...metadata,
        social_links: JSON.parse(metadata.social_links || "{}"),
        token_specifications: JSON.parse(metadata.token_specifications || "{}"),
        tags: JSON.parse(metadata.tags || "[]"),
      };
    } catch (error) {
      logger.error({ error, symbol }, "Failed to get asset metadata by symbol");
      return null;
    }
  }

  /**
   * Create or update asset metadata
   */
  async upsertMetadata(
    assetId: string,
    symbol: string,
    metadata: Partial<
      Omit<
        AssetMetadata,
        "id" | "asset_id" | "symbol" | "version" | "created_at" | "updated_at"
      >
    >,
    updatedBy: string,
  ): Promise<AssetMetadata> {
    const db = getDatabase();

    try {
      const existing = await db("asset_metadata")
        .where({ asset_id: assetId })
        .first();

      const metadataData = {
        logo_url: metadata.logo_url || null,
        description: metadata.description || null,
        website_url: metadata.website_url || null,
        contract_address: metadata.contract_address || null,
        social_links: JSON.stringify(metadata.social_links || {}),
        documentation_url: metadata.documentation_url || null,
        token_specifications: JSON.stringify(
          metadata.token_specifications || {},
        ),
        category: metadata.category || null,
        tags: JSON.stringify(metadata.tags || []),
        updated_at: new Date(),
      };

      if (existing) {
        // Update existing
        await db("asset_metadata")
          .where({ asset_id: assetId })
          .update({
            ...metadataData,
            version: existing.version + 1,
          });

        // Log version
        await this.logVersion(
          existing.id,
          existing.version + 1,
          metadata,
          updatedBy,
        );

        logger.info({ assetId, symbol }, "Asset metadata updated");
      } else {
        // Create new
        const id = randomBytes(16).toString("hex");
        await db("asset_metadata").insert({
          id,
          asset_id: assetId,
          symbol,
          ...metadataData,
          version: 1,
          created_at: new Date(),
        });

        // Log version
        await this.logVersion(id, 1, metadata, updatedBy);

        logger.info({ assetId, symbol }, "Asset metadata created");
      }

      return (await this.getMetadata(assetId))!;
    } catch (error) {
      logger.error({ error, assetId }, "Failed to upsert asset metadata");
      throw error;
    }
  }

  /**
   * Update logo URL
   */
  async updateLogo(
    assetId: string,
    logoUrl: string,
    updatedBy: string,
  ): Promise<void> {
    const db = getDatabase();

    try {
      const existing = await db("asset_metadata")
        .where({ asset_id: assetId })
        .first();

      if (existing) {
        await db("asset_metadata")
          .where({ asset_id: assetId })
          .update({
            logo_url: logoUrl,
            version: existing.version + 1,
            updated_at: new Date(),
          });

        await this.logVersion(
          existing.id,
          existing.version + 1,
          { logo_url: logoUrl },
          updatedBy,
        );
      }

      logger.info({ assetId, logoUrl }, "Asset logo updated");
    } catch (error) {
      logger.error({ error, assetId }, "Failed to update asset logo");
      throw error;
    }
  }

  /**
   * Get all metadata
   */
  async getAllMetadata(): Promise<AssetMetadata[]> {
    const db = getDatabase();

    try {
      const metadataList = await db("asset_metadata").orderBy("symbol");

      return metadataList.map((metadata: AssetMetadata) => ({
        ...metadata,
        social_links: JSON.parse(
          (metadata.social_links as unknown as string) || "{}",
        ),
        token_specifications: JSON.parse(
          (metadata.token_specifications as unknown as string) || "{}",
        ),
        tags: JSON.parse((metadata.tags as unknown as string) || "[]"),
      }));
    } catch (error) {
      logger.error({ error }, "Failed to get all asset metadata");
      return [];
    }
  }

  /**
   * Get metadata by category
   */
  async getMetadataByCategory(category: string): Promise<AssetMetadata[]> {
    const db = getDatabase();

    try {
      const metadataList = await db("asset_metadata")
        .where({ category })
        .orderBy("symbol");

      return metadataList.map((metadata: AssetMetadata) => ({
        ...metadata,
        social_links: JSON.parse(
          (metadata.social_links as unknown as string) || "{}",
        ),
        token_specifications: JSON.parse(
          (metadata.token_specifications as unknown as string) || "{}",
        ),
        tags: JSON.parse((metadata.tags as unknown as string) || "[]"),
      }));
    } catch (error) {
      logger.error({ error, category }, "Failed to get metadata by category");
      return [];
    }
  }

  /**
   * Search metadata
   */
  async searchMetadata(query: string): Promise<AssetMetadata[]> {
    const db = getDatabase();

    try {
      const metadataList = await db("asset_metadata")
        .where("symbol", "ilike", `%${query}%`)
        .orWhere("description", "ilike", `%${query}%`)
        .orWhere("category", "ilike", `%${query}%`)
        .orderBy("symbol");

      return metadataList.map((metadata: AssetMetadata) => ({
        ...metadata,
        social_links: JSON.parse(
          (metadata.social_links as unknown as string) || "{}",
        ),
        token_specifications: JSON.parse(
          (metadata.token_specifications as unknown as string) || "{}",
        ),
        tags: JSON.parse((metadata.tags as unknown as string) || "[]"),
      }));
    } catch (error) {
      logger.error({ error, query }, "Failed to search metadata");
      return [];
    }
  }

  /**
   * Get metadata version history
   */
  async getVersionHistory(assetId: string): Promise<MetadataVersion[]> {
    const db = getDatabase();

    try {
      const metadata = await db("asset_metadata")
        .where({ asset_id: assetId })
        .first();

      if (!metadata) {
        return [];
      }

      const versions = await db("asset_metadata_versions")
        .where({ metadata_id: metadata.id })
        .orderBy("version", "desc");

      return versions.map((v: MetadataVersion) => ({
        ...v,
        changes: JSON.parse((v.changes as unknown as string) || "{}"),
      }));
    } catch (error) {
      logger.error({ error, assetId }, "Failed to get version history");
      return [];
    }
  }

  /**
   * Validate metadata
   */
  validateMetadata(metadata: Partial<AssetMetadata>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (metadata.website_url && !this.isValidUrl(metadata.website_url)) {
      errors.push("Invalid website URL");
    }

    if (
      metadata.documentation_url &&
      !this.isValidUrl(metadata.documentation_url)
    ) {
      errors.push("Invalid documentation URL");
    }

    if (metadata.social_links) {
      for (const [platform, url] of Object.entries(metadata.social_links)) {
        if (url && !this.isValidUrl(url)) {
          errors.push(`Invalid ${platform} URL`);
        }
      }
    }

    if (metadata.logo_url && !this.isValidUrl(metadata.logo_url)) {
      errors.push("Invalid logo URL");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Delete metadata
   */
  async deleteMetadata(assetId: string): Promise<void> {
    const db = getDatabase();

    try {
      await db("asset_metadata").where({ asset_id: assetId }).delete();

      logger.info({ assetId }, "Asset metadata deleted");
    } catch (error) {
      logger.error({ error, assetId }, "Failed to delete asset metadata");
      throw error;
    }
  }

  // ─── Private Methods ─────────────────────────────────────────────────────

  private async logVersion(
    metadataId: string,
    version: number,
    changes: Record<string, unknown>,
    changedBy: string,
  ): Promise<void> {
    const db = getDatabase();

    try {
      await db("asset_metadata_versions").insert({
        id: randomBytes(16).toString("hex"),
        metadata_id: metadataId,
        version,
        changes: JSON.stringify(changes),
        changed_by: changedBy,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error({ error, metadataId }, "Failed to log metadata version");
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const assetMetadataService = new AssetMetadataService();
