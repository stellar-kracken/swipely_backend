import { getDatabase } from "../connection.js";

export interface Bridge {
  id: string;
  name: string;
  source_chain: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  total_value_locked: number;
  supply_on_stellar: number;
  supply_on_source: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export class BridgeModel {
  private db = getDatabase();
  private table = "bridges";

  async findAll(activeOnly = true): Promise<Bridge[]> {
    const query = this.db(this.table).select("*");
    if (activeOnly) query.where("is_active", true);
    return query;
  }

  async findByName(name: string): Promise<Bridge | undefined> {
    return this.db(this.table).where("name", name).first();
  }

  async create(data: Omit<Bridge, "id" | "created_at" | "updated_at">): Promise<Bridge> {
    const [bridge] = await this.db(this.table).insert(data).returning("*");
    return bridge;
  }

  async updateStatus(
    name: string,
    status: Bridge["status"],
    supplyData?: {
      supply_on_stellar?: number;
      supply_on_source?: number;
      total_value_locked?: number;
    }
  ): Promise<Bridge | undefined> {
    const [bridge] = await this.db(this.table)
      .where("name", name)
      .update({ status, ...supplyData, updated_at: new Date() })
      .returning("*");
    return bridge;
  }
}
