import { describe, expect, it } from "vitest";
import {
  ProvenanceService,
  type ProvenanceGraph,
} from "../../src/services/provenance.service.js";

function findReachableDestinations(graph: ProvenanceGraph, startId: string): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }

  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return graph.nodes
    .filter((node) => node.kind === "destination" && visited.has(node.id))
    .map((node) => node.id);
}

describe("ProvenanceService", () => {
  const service = new ProvenanceService();

  it("records available lineage entries with metric, asset, bridge, and node counts", () => {
    const metrics = service.listMetrics();

    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "price", asset: "USDC", bridge: null, nodeCount: 4 }),
        expect.objectContaining({ metric: "health", asset: "USDC", bridge: null, nodeCount: 6 }),
        expect.objectContaining({ metric: "tvl", asset: null, bridge: "Allbridge", nodeCount: 5 }),
      ]),
    );
    for (const item of metrics) {
      expect(new Date(item.lastUpdated).toString()).not.toBe("Invalid Date");
      expect(item.nodeCount).toBeGreaterThan(0);
    }
  });

  it("filters graph summaries by asset, bridge, and metric", () => {
    expect(service.listMetrics({ asset: "USDC" }).map((item) => item.metric).sort()).toEqual([
      "health",
      "price",
    ]);
    expect(service.listMetrics({ bridge: "Allbridge" })).toEqual([
      expect.objectContaining({ metric: "tvl", bridge: "Allbridge" }),
    ]);
    expect(service.listMetrics({ metric: "alerts", asset: "EURC" })).toEqual([
      expect.objectContaining({ metric: "alerts", asset: "EURC" }),
    ]);
  });

  it("returns a complete lineage graph for asset-scoped metrics", () => {
    const graph = service.getLineage("price", "USDC");

    expect(graph).toMatchObject({
      metric: "price",
      asset: "USDC",
      bridge: null,
    });
    expect(graph?.nodes).toHaveLength(4);
    expect(graph?.edges).toEqual([
      expect.objectContaining({ from: "coinbase-feed", to: "price-aggregator", transformKind: "fetch" }),
      expect.objectContaining({ from: "binance-feed", to: "price-aggregator", transformKind: "fetch" }),
      expect.objectContaining({ from: "price-aggregator", to: "price-store", transformKind: "aggregate" }),
    ]);
  });

  it("returns a bridge-scoped graph and preserves transform traversal order", () => {
    const graph = service.getLineage("tvl", undefined, "Allbridge");

    expect(graph?.bridge).toBe("Allbridge");
    expect(graph?.edges.map((edge) => edge.transformKind)).toEqual([
      "fetch",
      "fetch",
      "normalize",
      "reconcile",
    ]);
  });

  it("supports traversing from source nodes to destination nodes", () => {
    const graph = service.getLineage("alerts", "EURC");

    expect(graph).not.toBeNull();
    expect(findReachableDestinations(graph!, "health-trigger")).toEqual(["notification-dest"]);
  });

  it("returns null when no graph exists for the requested scope", () => {
    expect(service.getLineage("price", "EURC")).toBeNull();
    expect(service.getLineage("tvl", undefined, "UnknownBridge")).toBeNull();
  });
});
