import crypto from "crypto";
import { TagModel, Tag } from "../database/models/tag.model.js";
import { AssetModel } from "../database/models/asset.model.js";
import { auditService } from "./audit.service.js";
import { logger } from "../utils/logger.js";
import { getDatabase } from "../database/connection.js";

export class AssetTagService {
  private tagModel = new TagModel();
  private assetModel = new AssetModel();

  async createTag(
    name: string,
    color: string | null,
    performedBy: string,
    actorType: "user" | "api_key" | "system" = "user"
  ): Promise<Tag> {
    if (!name || !name.trim()) {
      throw new Error("Tag name is required");
    }

    const trimmedName = name.trim();
    const existing = await this.tagModel.findByName(trimmedName);
    if (existing) {
      throw new Error(`Tag with name "${trimmedName}" already exists`);
    }

    const id = crypto.randomUUID();
    const tag = await this.tagModel.create({
      id,
      name: trimmedName,
      color: color || null,
    });

    await auditService.log({
      action: "tag.created",
      actorId: performedBy,
      actorType,
      resourceType: "tag",
      resourceId: tag.id,
      after: tag as any,
      metadata: { name: tag.name },
    });

    logger.info({ tagId: tag.id, name: tag.name, performedBy }, "Asset tag created successfully");
    return tag;
  }

  async getAllTags(): Promise<Tag[]> {
    return this.tagModel.findAll();
  }

  async getTagById(id: string): Promise<Tag | null> {
    const tag = await this.tagModel.findById(id);
    return tag || null;
  }

  async getTagByName(name: string): Promise<Tag | null> {
    const tag = await this.tagModel.findByName(name);
    return tag || null;
  }

  async updateTag(
    id: string,
    data: { name?: string; color?: string | null },
    performedBy: string,
    actorType: "user" | "api_key" | "system" = "user"
  ): Promise<Tag> {
    const existing = await this.tagModel.findById(id);
    if (!existing) {
      throw new Error(`Tag with ID "${id}" not found`);
    }

    const updateData: Partial<Omit<Tag, "id" | "created_at" | "updated_at">> = {};
    if (data.name !== undefined) {
      const trimmedName = data.name.trim();
      if (!trimmedName) {
        throw new Error("Tag name cannot be empty");
      }
      if (trimmedName !== existing.name) {
        const nameConflict = await this.tagModel.findByName(trimmedName);
        if (nameConflict) {
          throw new Error(`Tag with name "${trimmedName}" already exists`);
        }
        updateData.name = trimmedName;
      }
    }

    if (data.color !== undefined) {
      updateData.color = data.color || null;
    }

    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    const updated = await this.tagModel.update(id, updateData);
    if (!updated) {
      throw new Error("Failed to update tag");
    }

    await auditService.log({
      action: "tag.updated",
      actorId: performedBy,
      actorType,
      resourceType: "tag",
      resourceId: id,
      before: existing as any,
      after: updated as any,
      metadata: { changes: updateData },
    });

    logger.info({ tagId: id, performedBy }, "Asset tag updated successfully");
    return updated;
  }

  async deleteTag(
    id: string,
    performedBy: string,
    actorType: "user" | "api_key" | "system" = "user"
  ): Promise<void> {
    const existing = await this.tagModel.findById(id);
    if (!existing) {
      throw new Error(`Tag with ID "${id}" not found`);
    }

    await this.tagModel.delete(id);

    await auditService.log({
      action: "tag.deleted",
      actorId: performedBy,
      actorType,
      resourceType: "tag",
      resourceId: id,
      before: existing as any,
      metadata: { name: existing.name },
    });

    logger.info({ tagId: id, name: existing.name, performedBy }, "Asset tag deleted successfully");
  }

  async assignTagToAsset(
    assetSymbol: string,
    tagName: string,
    performedBy: string,
    actorType: "user" | "api_key" | "system" = "user"
  ): Promise<void> {
    const asset = await this.assetModel.findBySymbol(assetSymbol);
    if (!asset) {
      throw new Error(`Asset with symbol "${assetSymbol}" not found`);
    }

    const trimmedTagName = tagName.trim();
    let tag = await this.tagModel.findByName(trimmedTagName);
    if (!tag) {
      tag = await this.createTag(trimmedTagName, null, performedBy, actorType);
    }

    await this.tagModel.assign(asset.id, tag.id);

    await auditService.log({
      action: "tag.assigned",
      actorId: performedBy,
      actorType,
      resourceType: "asset",
      resourceId: asset.id,
      metadata: { assetSymbol, tagId: tag.id, tagName: tag.name },
    });

    logger.info({ assetSymbol, tagName: tag.name, performedBy }, "Asset tag assigned successfully");
  }

  async unassignTagFromAsset(
    assetSymbol: string,
    tagName: string,
    performedBy: string,
    actorType: "user" | "api_key" | "system" = "user"
  ): Promise<void> {
    const asset = await this.assetModel.findBySymbol(assetSymbol);
    if (!asset) {
      throw new Error(`Asset with symbol "${assetSymbol}" not found`);
    }

    const tag = await this.tagModel.findByName(tagName.trim());
    if (!tag) {
      throw new Error(`Tag with name "${tagName}" not found`);
    }

    const deletedCount = await this.tagModel.unassign(asset.id, tag.id);
    if (deletedCount > 0) {
      await auditService.log({
        action: "tag.unassigned",
        actorId: performedBy,
        actorType,
        resourceType: "asset",
        resourceId: asset.id,
        metadata: { assetSymbol, tagId: tag.id, tagName: tag.name },
      });
      logger.info({ assetSymbol, tagName: tag.name, performedBy }, "Asset tag unassigned successfully");
    }
  }

  async bulkAssignTags(
    assetSymbols: string[],
    tagNames: string[],
    performedBy: string,
    actorType: "user" | "api_key" | "system" = "user"
  ): Promise<{ assignedCount: number; assetsProcessed: number; tagsProcessed: number }> {
    if (!assetSymbols.length || !tagNames.length) {
      return { assignedCount: 0, assetsProcessed: 0, tagsProcessed: 0 };
    }

    const db = getDatabase();
    let assignedCount = 0;

    await db.transaction(async (trx) => {
      // Find all assets
      const assets = await trx("assets")
        .whereIn("symbol", assetSymbols)
        .select("id", "symbol");

      if (assets.length === 0) {
        throw new Error("None of the specified assets were found");
      }

      // Find or create tags
      const tags: Tag[] = [];
      for (const name of tagNames) {
        const trimmedName = name.trim();
        if (!trimmedName) continue;
        let tagRow = await trx("tags").where("name", trimmedName).first();
        if (!tagRow) {
          const id = crypto.randomUUID();
          [tagRow] = await trx("tags")
            .insert({
              id,
              name: trimmedName,
              color: null,
              created_at: new Date(),
              updated_at: new Date(),
            })
            .returning("*");

          await auditService.log({
            action: "tag.created",
            actorId: performedBy,
            actorType,
            resourceType: "tag",
            resourceId: tagRow.id,
            after: tagRow,
            metadata: { name: trimmedName, bulk: true },
          });
        }
        tags.push(tagRow);
      }

      // Perform assignments
      for (const asset of assets) {
        for (const tag of tags) {
          const exist = await trx("asset_tags")
            .where({ asset_id: asset.id, tag_id: tag.id })
            .first();

          if (!exist) {
            await trx("asset_tags").insert({
              asset_id: asset.id,
              tag_id: tag.id,
              created_at: new Date(),
            });

            await auditService.log({
              action: "tag.assigned",
              actorId: performedBy,
              actorType,
              resourceType: "asset",
              resourceId: asset.id,
              metadata: { assetSymbol: asset.symbol, tagId: tag.id, tagName: tag.name, bulk: true },
            });

            assignedCount++;
          }
        }
      }
    });

    logger.info(
      { assetSymbolsCount: assetSymbols.length, tagNamesCount: tagNames.length, assignedCount, performedBy },
      "Bulk tag assignment completed successfully"
    );

    return {
      assignedCount,
      assetsProcessed: assetSymbols.length,
      tagsProcessed: tagNames.length,
    };
  }

  async getTagsForAsset(assetSymbol: string): Promise<Tag[]> {
    const asset = await this.assetModel.findBySymbol(assetSymbol);
    if (!asset) {
      throw new Error(`Asset with symbol "${assetSymbol}" not found`);
    }
    return this.tagModel.getTagsForAsset(asset.id);
  }
}

export const assetTagService = new AssetTagService();
