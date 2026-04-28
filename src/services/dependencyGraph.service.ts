export type DependencyNodeType =
  | "bridge"
  | "oracle"
  | "indexer"
  | "rpc"
  | "queue"
  | "database"
  | "notifier"
  | "api";

export type DependencyNodeStatus = "healthy" | "degraded" | "down" | "unknown";

export interface DependencyNode {
  id: string;
  label: string;
  type: DependencyNodeType;
  status: DependencyNodeStatus;
  description: string;
  impactHint: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "data" | "control" | "notification";
}

export interface DependencyGraphResponse {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  summary: {
    totalNodes: number;
    totalEdges: number;
    downServices: number;
    degradedServices: number;
  };
}

const BASE_NODES: DependencyNode[] = [
  {
    id: "api-gateway",
    label: "API Gateway",
    type: "api",
    status: "healthy",
    description: "Serves dashboard and alert APIs",
    impactHint: "UI and automations stop reading fresh bridge telemetry.",
  },
  {
    id: "event-indexer",
    label: "Event Indexer",
    type: "indexer",
    status: "healthy",
    description: "Consumes bridge and chain events",
    impactHint: "Transactions and analytics panels become stale.",
  },
  {
    id: "stellar-rpc",
    label: "Stellar RPC",
    type: "rpc",
    status: "healthy",
    description: "Reads Stellar chain state and transactions",
    impactHint: "Asset health and transfer confirmations degrade.",
  },
  {
    id: "ethereum-rpc",
    label: "Ethereum RPC",
    type: "rpc",
    status: "degraded",
    description: "Reads Ethereum side reserve and bridge data",
    impactHint: "Cross-chain reserve checks become delayed.",
  },
  {
    id: "price-oracle",
    label: "Price Oracle",
    type: "oracle",
    status: "healthy",
    description: "Provides external pricing feeds",
    impactHint: "Risk metrics may underreact to market movement.",
  },
  {
    id: "timescale-db",
    label: "TimescaleDB",
    type: "database",
    status: "healthy",
    description: "Stores historical telemetry and alerts",
    impactHint: "History queries and reports fail when unavailable.",
  },
  {
    id: "alert-queue",
    label: "Alert Queue",
    type: "queue",
    status: "healthy",
    description: "Buffers alert, webhook, and breaker jobs",
    impactHint: "Notifications and auto-mitigation lag or stop.",
  },
  {
    id: "notification-service",
    label: "Notification Service",
    type: "notifier",
    status: "unknown",
    description: "Delivers email/webhook incident updates",
    impactHint: "Operators lose proactive incident visibility.",
  },
  {
    id: "stellar-usdc-bridge",
    label: "Stellar USDC Bridge",
    type: "bridge",
    status: "healthy",
    description: "Bridge execution for USDC flows",
    impactHint: "USDC cross-chain transfers halt or stall.",
  },
  {
    id: "stellar-eurc-bridge",
    label: "Stellar EURC Bridge",
    type: "bridge",
    status: "down",
    description: "Bridge execution for EURC flows",
    impactHint: "EURC transfers are unavailable until recovered.",
  },
];

const BASE_EDGES: DependencyEdge[] = [
  { from: "api-gateway", to: "timescale-db", kind: "data" },
  { from: "api-gateway", to: "alert-queue", kind: "control" },
  { from: "event-indexer", to: "stellar-rpc", kind: "data" },
  { from: "event-indexer", to: "ethereum-rpc", kind: "data" },
  { from: "event-indexer", to: "timescale-db", kind: "data" },
  { from: "stellar-usdc-bridge", to: "event-indexer", kind: "data" },
  { from: "stellar-eurc-bridge", to: "event-indexer", kind: "data" },
  { from: "price-oracle", to: "event-indexer", kind: "data" },
  { from: "alert-queue", to: "notification-service", kind: "notification" },
  { from: "timescale-db", to: "notification-service", kind: "data" },
];

export class DependencyGraphService {
  getGraph(filters?: {
    type?: string;
    status?: string;
    search?: string;
  }): DependencyGraphResponse {
    const search = filters?.search?.trim().toLowerCase();
    const typeFilter = filters?.type?.trim().toLowerCase();
    const statusFilter = filters?.status?.trim().toLowerCase();

    const nodes = BASE_NODES.filter((node) => {
      if (typeFilter && typeFilter !== "all" && node.type !== typeFilter) {
        return false;
      }

      if (statusFilter && statusFilter !== "all" && node.status !== statusFilter) {
        return false;
      }

      if (search) {
        const haystack = `${node.label} ${node.description} ${node.id}`.toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }

      return true;
    });

    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const edges = BASE_EDGES.filter(
      (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)
    );

    return {
      nodes,
      edges,
      summary: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        downServices: nodes.filter((node) => node.status === "down").length,
        degradedServices: nodes.filter((node) => node.status === "degraded").length,
      },
    };
  }
}

export const dependencyGraphService = new DependencyGraphService();
