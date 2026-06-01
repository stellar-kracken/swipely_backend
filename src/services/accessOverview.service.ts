export interface WorkspaceAccessSummary {
  workspaceId: string;
  workspaceName: string;
  roles: Record<string, string[]>;
}

export class AccessOverviewService {
  // Lightweight in-memory stub; replace with DB queries or API calls as needed
  private readonly summaries: WorkspaceAccessSummary[] = [];

  async listSummaries(): Promise<WorkspaceAccessSummary[]> {
    return this.summaries.slice();
  }

  async addSummary(summary: WorkspaceAccessSummary) {
    this.summaries.push(summary);
    return summary;
  }
}

export const accessOverviewService = new AccessOverviewService();
