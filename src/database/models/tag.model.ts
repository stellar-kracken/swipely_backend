import { getDatabase } from "../connection.js";

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AssetTag {
  asset_id: string;
  tag_id: string;
  created_at: Date;
}

export class TagModel {
  private db = getDatabase();

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

  // Association methods

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
}
