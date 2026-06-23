import { getDatabase } from "../connection.js";

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  entity_type?: string;
  entity_id?: string;
  tag?: string;
  source?: string;
  created_at: Date;
  updated_at: Date;
}

export interface AssetTag {
  asset_id: string;
  tag_id: string;
  created_at: Date;
}

export interface TagAuditEntry {
  id: string;
  time: Date;
  entity_type: string;
  entity_id: string;
  tag: string;
  action: string;
  source: string;
  metadata: Record<string, unknown> | null;
}

export class TagModel {
  private db = getDatabase();
  private tagsTable = "tags";
  private auditTable = "tag_audit_log";

  async findAll(): Promise<Tag[]> {
    return this.db("tags").select("*").orderBy("name", "asc");
  }

  async findById(id: string): Promise<Tag | undefined> {
    return this.db("tags").where("id", id).first();
  }

  async findByName(name: string): Promise<Tag | undefined> {
    return this.db("tags").where("name", name).first();
  }

  async create(data: Omit<Tag, "created_at" | "updated_at">): Promise<Tag> {
    const [tag] = await this.db("tags")
      .insert({
        ...data,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning("*");
    return tag;
  }

  async update(id: string, data: Partial<Omit<Tag, "id" | "created_at" | "updated_at">>): Promise<Tag | undefined> {
    const [tag] = await this.db("tags")
      .where("id", id)
      .update({
        ...data,
        updated_at: new Date(),
      })
      .returning("*");
    return tag;
  }

  async delete(id: string): Promise<number> {
    return this.db("tags").where("id", id).delete();
  }

  async assign(assetId: string, tagId: string): Promise<void> {
    await this.db("asset_tags")
      .insert({
        asset_id: assetId,
        tag_id: tagId,
        created_at: new Date(),
      })
      .onConflict(["asset_id", "tag_id"])
      .ignore();
  }

  async unassign(assetId: string, tagId: string): Promise<number> {
    return this.db("asset_tags")
      .where({ asset_id: assetId, tag_id: tagId })
      .delete();
  }

  async getTagsForAsset(assetId: string): Promise<Tag[]> {
    return this.db("tags")
      .join("asset_tags", "tags.id", "asset_tags.tag_id")
      .where("asset_tags.asset_id", assetId)
      .select("tags.*")
      .orderBy("tags.name", "asc");
  }

  async getTagsForAssets(assetIds: string[]): Promise<{ asset_id: string; tag: Tag }[]> {
    if (!assetIds.length) return [];
    const rows = await this.db("tags")
      .join("asset_tags", "tags.id", "asset_tags.tag_id")
      .whereIn("asset_tags.asset_id", assetIds)
      .select("asset_tags.asset_id", "tags.*");

    return rows.map((row: any) => ({
      asset_id: row.asset_id,
      tag: {
        id: row.id,
        name: row.name,
        color: row.color,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    }));
  }

  async getAssetIdsForTag(tagId: string): Promise<string[]> {
    const rows = await this.db("asset_tags")
      .where("tag_id", tagId)
      .select("asset_id");
    return rows.map((r: any) => r.asset_id);
  }

  async getAssetIdsForTags(tagIds: string[]): Promise<string[]> {
    if (!tagIds.length) return [];
    const rows = await this.db("asset_tags")
      .whereIn("tag_id", tagIds)
      .select("asset_id")
      .groupBy("asset_id")
      .havingRaw("count(distinct tag_id) = ?", [tagIds.length]);
    return rows.map((r: any) => r.asset_id);
  }

  async clearTagsForAsset(assetId: string): Promise<number> {
    return this.db("asset_tags").where("asset_id", assetId).delete();
  }

  async findByEntity(entityType: string, entityId: string): Promise<Tag[]> {
    return this.db(this.tagsTable)
      .where({ entity_type: entityType, entity_id: entityId })
      .orderBy("created_at", "desc");
  }

  async findEntitiesByTag(
    tag: string,
    entityType?: string
  ): Promise<Array<{ entity_type: string; entity_id: string }>> {
    const query = this.db(this.tagsTable)
      .where({ tag })
      .select("entity_type", "entity_id")
      .distinct();

    if (entityType) {
      query.where("entity_type", entityType);
    }

    return query;
  }

  async addTag(
    entityType: string,
    entityId: string,
    tag: string,
    source = "manual"
  ): Promise<Tag> {
    const [existing] = await this.db(this.tagsTable)
      .where({ entity_type: entityType, entity_id: entityId, tag })
      .select("id");

    if (existing) {
      return existing;
    }

    const [created] = await this.db(this.tagsTable)
      .insert({ entity_type: entityType, entity_id: entityId, tag, source })
      .returning("*");

    await this.logAudit(entityType, entityId, tag, "add", source);
    return created;
  }

  async removeEntityTag(
    entityType: string,
    entityId: string,
    tag: string,
    source = "manual"
  ): Promise<boolean> {
    const count = await this.db(this.tagsTable)
      .where({ entity_type: entityType, entity_id: entityId, tag })
      .del();

    if (count > 0) {
      await this.logAudit(entityType, entityId, tag, "remove", source);
    }

    return count > 0;
  }

  async syncTags(
    entityType: string,
    entityId: string,
    desiredTags: string[],
    source = "sync"
  ): Promise<{ added: string[]; removed: string[] }> {
    const current = await this.findByEntity(entityType, entityId);
    const currentTags = new Set(current.map((t) => t.tag));
    const desired = new Set(desiredTags);

    const added: string[] = [];
    const removed: string[] = [];

    for (const tag of desired) {
      if (!currentTags.has(tag)) {
        await this.addTag(entityType, entityId, tag, source);
        added.push(tag);
      }
    }

    for (const tag of currentTags) {
      if (!desired.has(tag)) {
        await this.removeEntityTag(entityType, entityId, tag, source);
        removed.push(tag);
      }
    }

    return { added, removed };
  }

  async getAuditLog(
    entityType: string,
    entityId: string,
    limit = 50
  ): Promise<TagAuditEntry[]> {
    return this.db(this.auditTable)
      .where({ entity_type: entityType, entity_id: entityId })
      .orderBy("time", "desc")
      .limit(limit);
  }

  async getAllEntityTags(): Promise<Array<{ tag: string; count: number }>> {
    const rows = await this.db(this.tagsTable)
      .select("tag")
      .count("id as count")
      .groupBy("tag")
      .orderBy("count", "desc");
    return rows as Array<{ tag: string; count: number }>;
  }

  private async logAudit(
    entityType: string,
    entityId: string,
    tag: string,
    action: string,
    source: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.db(this.auditTable).insert({
      entity_type: entityType,
      entity_id: entityId,
      tag,
      action,
      source,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  }
}
