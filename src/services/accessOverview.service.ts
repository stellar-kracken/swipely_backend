import { getDatabase } from "../database/connection.js";

export interface WorkspaceAccessSummary {
  workspaceId: string;
  workspaceName: string;
  roles: Record<string, string[]>;
}

export class AccessOverviewService {
  async listSummaries(): Promise<WorkspaceAccessSummary[]> {
    const db = getDatabase();

    const bridges = await db("bridges")
      .select("id", "name")
      .where("is_active", true)
      .orderBy("name");

    const operators = await db("bridge_operators")
      .select("bridge_id", "operator_address", "provider_name", "is_active")
      .where("is_active", true);

    const operatorsByBridgeName = new Map<string, { address: string; provider: string }[]>();
    for (const op of operators) {
      const list = operatorsByBridgeName.get(op.bridge_id) ?? [];
      list.push({ address: op.operator_address, provider: op.provider_name });
      operatorsByBridgeName.set(op.bridge_id, list);
    }

    return bridges.map((bridge) => {
      const ops = operatorsByBridgeName.get(bridge.name) ?? [];
      const roles: Record<string, string[]> = { operator: [] };
      for (const op of ops) {
        roles.operator.push(op.address);
      }
      return {
        workspaceId: bridge.id,
        workspaceName: bridge.name,
        roles,
      };
    });
  }

  async addSummary(summary: WorkspaceAccessSummary) {
    return summary;
  }
}

export const accessOverviewService = new AccessOverviewService();
