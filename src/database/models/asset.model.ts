import { getDatabase } from "../connection.js";

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  issuer: string | null;
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12";
  bridge_provider: string | null;
  source_chain: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export class AssetModel {
  private db = getDatabase();
  private table = "assets";

  async findAll(activeOnly = true): Promise<Asset[]> {
    const query = this.db(this.table).select("*");
    if (activeOnly) query.where("is_active", true);
    return query;
  }

  async findBySymbol(symbol: string): Promise<Asset | undefined> {
    return this.db(this.table).where("symbol", symbol).first();
  }

  async create(data: Omit<Asset, "id" | "created_at" | "updated_at">): Promise<Asset> {
    const [asset] = await this.db(this.table).insert(data).returning("*");
    return asset;
  }

  async update(symbol: string, data: Partial<Asset>): Promise<Asset | undefined> {
    const [asset] = await this.db(this.table)
      .where("symbol", symbol)
      .update({ ...data, updated_at: new Date() })
      .returning("*");
    return asset;
  }
}
