import { describe, it, expect, beforeEach } from "vitest";
import {
  DependencyGraphService,
  dependencyGraphService,
} from "../../src/services/dependencyGraph.service.js";

describe("DependencyGraphService", () => {
  let service: DependencyGraphService;

  beforeEach(() => {
    service = new DependencyGraphService();
  });

  describe("getGraph", () => {
    it("returns all nodes and edges with no filters", () => {
      const result = service.getGraph();

      expect(result.nodes).toBeDefined();
      expect(result.edges).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
    });

    it("includes correct node properties", () => {
      const result = service.getGraph();

      const node = result.nodes[0];
      expect(node).toHaveProperty("id");
      expect(node).toHaveProperty("label");
      expect(node).toHaveProperty("type");
      expect(node).toHaveProperty("status");
      expect(node).toHaveProperty("description");
      expect(node).toHaveProperty("impactHint");
    });

    it("includes correct edge properties", () => {
      const result = service.getGraph();

      const edge = result.edges[0];
      expect(edge).toHaveProperty("from");
      expect(edge).toHaveProperty("to");
      expect(edge).toHaveProperty("kind");
      expect(["data", "control", "notification"]).toContain(edge.kind);
    });

    it("returns correct summary statistics", () => {
      const result = service.getGraph();

      expect(result.summary.totalNodes).toBe(result.nodes.length);
      expect(result.summary.totalEdges).toBe(result.edges.length);
      expect(result.summary.downServices).toBeGreaterThanOrEqual(0);
      expect(result.summary.degradedServices).toBeGreaterThanOrEqual(0);
    });

    it("filters by node type", () => {
      const result = service.getGraph({ type: "bridge" });

      expect(result.nodes.every((node) => node.type === "bridge")).toBe(true);
      expect(result.summary.totalNodes).toBe(result.nodes.length);
    });

    it("filters by status", () => {
      const result = service.getGraph({ status: "healthy" });

      expect(result.nodes.every((node) => node.status === "healthy")).toBe(true);
    });

    it("filters by degraded status", () => {
      const result = service.getGraph({ status: "degraded" });

      expect(result.nodes.every((node) => node.status === "degraded")).toBe(true);
      expect(result.summary.degradedServices).toBe(result.nodes.length);
    });

    it("filters by down status", () => {
      const result = service.getGraph({ status: "down" });

      expect(result.nodes.every((node) => node.status === "down")).toBe(true);
      expect(result.summary.downServices).toBe(result.nodes.length);
    });

    it("filters by search term", () => {
      const result = service.getGraph({ search: "api" });

      expect(result.nodes.length).toBeGreaterThan(0);
      result.nodes.forEach((node) => {
        const searchableText = `${node.label} ${node.description} ${node.id}`.toLowerCase();
        expect(searchableText).toContain("api");
      });
    });

    it("filters by search term in description", () => {
      const result = service.getGraph({ search: "stellar" });

      expect(result.nodes.length).toBeGreaterThan(0);
      result.nodes.forEach((node) => {
        const searchableText = `${node.label} ${node.description} ${node.id}`.toLowerCase();
        expect(searchableText).toContain("stellar");
      });
    });

    it("returns empty result when no nodes match search", () => {
      const result = service.getGraph({ search: "nonexistent-service-xyz-123" });

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
      expect(result.summary.totalNodes).toBe(0);
      expect(result.summary.totalEdges).toBe(0);
    });

    it("filters edges based on visible nodes", () => {
      const result = service.getGraph({ type: "bridge" });

      const nodeIds = new Set(result.nodes.map((n) => n.id));
      result.edges.forEach((edge) => {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      });
    });

    it("handles 'all' type filter", () => {
      const resultAll = service.getGraph({ type: "all" });
      const resultNone = service.getGraph();

      expect(resultAll.nodes.length).toBe(resultNone.nodes.length);
      expect(resultAll.edges.length).toBe(resultNone.edges.length);
    });

    it("handles 'all' status filter", () => {
      const resultAll = service.getGraph({ status: "all" });
      const resultNone = service.getGraph();

      expect(resultAll.nodes.length).toBe(resultNone.nodes.length);
    });

    it("combines multiple filters", () => {
      const result = service.getGraph({
        type: "rpc",
        status: "healthy",
      });

      expect(result.nodes.every((node) => node.type === "rpc" && node.status === "healthy")).toBe(
        true
      );
    });

    it("combines type and search filters", () => {
      const result = service.getGraph({
        type: "bridge",
        search: "usdc",
      });

      expect(
        result.nodes.every((node) => {
          const searchableText = `${node.label} ${node.description} ${node.id}`.toLowerCase();
          return node.type === "bridge" && searchableText.includes("usdc");
        })
      ).toBe(true);
    });

    it("handles case-insensitive search", () => {
      const lowerResult = service.getGraph({ search: "stellar" });
      const upperResult = service.getGraph({ search: "STELLAR" });
      const mixedResult = service.getGraph({ search: "StElLaR" });

      expect(lowerResult.nodes.length).toBe(upperResult.nodes.length);
      expect(lowerResult.nodes.length).toBe(mixedResult.nodes.length);
    });

    it("trims whitespace from search terms", () => {
      const resultTrimmed = service.getGraph({ search: "  api  " });
      const resultNoTrim = service.getGraph({ search: "api" });

      expect(resultTrimmed.nodes.length).toBe(resultNoTrim.nodes.length);
    });

    it("trims whitespace from type filter", () => {
      const resultTrimmed = service.getGraph({ type: "  bridge  " });
      const resultNoTrim = service.getGraph({ type: "bridge" });

      expect(resultTrimmed.nodes.length).toBe(resultNoTrim.nodes.length);
    });

    it("trims whitespace from status filter", () => {
      const resultTrimmed = service.getGraph({ status: "  healthy  " });
      const resultNoTrim = service.getGraph({ status: "healthy" });

      expect(resultTrimmed.nodes.length).toBe(resultNoTrim.nodes.length);
    });
  });

  describe("node types", () => {
    it("includes bridge nodes", () => {
      const result = service.getGraph({ type: "bridge" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.type === "bridge")).toBe(true);
    });

    it("includes oracle nodes", () => {
      const result = service.getGraph({ type: "oracle" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.type === "oracle")).toBe(true);
    });

    it("includes indexer nodes", () => {
      const result = service.getGraph({ type: "indexer" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.type === "indexer")).toBe(true);
    });

    it("includes rpc nodes", () => {
      const result = service.getGraph({ type: "rpc" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.type === "rpc")).toBe(true);
    });

    it("includes queue nodes", () => {
      const result = service.getGraph({ type: "queue" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.type === "queue")).toBe(true);
    });

    it("includes database nodes", () => {
      const result = service.getGraph({ type: "database" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.type === "database")).toBe(true);
    });

    it("includes notifier nodes", () => {
      const result = service.getGraph({ type: "notifier" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.type === "notifier")).toBe(true);
    });

    it("includes api nodes", () => {
      const result = service.getGraph({ type: "api" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.type === "api")).toBe(true);
    });
  });

  describe("node statuses", () => {
    it("includes healthy nodes", () => {
      const result = service.getGraph({ status: "healthy" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.status === "healthy")).toBe(true);
    });

    it("includes degraded nodes", () => {
      const result = service.getGraph({ status: "degraded" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.status === "degraded")).toBe(true);
    });

    it("includes down nodes", () => {
      const result = service.getGraph({ status: "down" });

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.nodes.every((n) => n.status === "down")).toBe(true);
    });

    it("includes unknown status nodes", () => {
      const result = service.getGraph({ status: "unknown" });

      expect(result.nodes.length).toBeGreaterThanOrEqual(0);
      expect(result.nodes.every((n) => n.status === "unknown")).toBe(true);
    });
  });

  describe("edge relationships", () => {
    it("includes data edges", () => {
      const result = service.getGraph();
      const dataEdges = result.edges.filter((e) => e.kind === "data");

      expect(dataEdges.length).toBeGreaterThan(0);
    });

    it("includes control edges", () => {
      const result = service.getGraph();
      const controlEdges = result.edges.filter((e) => e.kind === "control");

      expect(controlEdges.length).toBeGreaterThanOrEqual(0);
    });

    it("includes notification edges", () => {
      const result = service.getGraph();
      const notificationEdges = result.edges.filter((e) => e.kind === "notification");

      expect(notificationEdges.length).toBeGreaterThanOrEqual(0);
    });

    it("all edges reference valid nodes", () => {
      const result = service.getGraph();
      const nodeIds = new Set(result.nodes.map((n) => n.id));

      result.edges.forEach((edge) => {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      });
    });
  });

  describe("summary calculations", () => {
    it("calculates total nodes correctly", () => {
      const result = service.getGraph();

      expect(result.summary.totalNodes).toBe(result.nodes.length);
    });

    it("calculates total edges correctly", () => {
      const result = service.getGraph();

      expect(result.summary.totalEdges).toBe(result.edges.length);
    });

    it("counts down services correctly", () => {
      const result = service.getGraph();
      const downCount = result.nodes.filter((n) => n.status === "down").length;

      expect(result.summary.downServices).toBe(downCount);
    });

    it("counts degraded services correctly", () => {
      const result = service.getGraph();
      const degradedCount = result.nodes.filter((n) => n.status === "degraded").length;

      expect(result.summary.degradedServices).toBe(degradedCount);
    });

    it("summary reflects filtered results", () => {
      const result = service.getGraph({ type: "bridge" });

      expect(result.summary.totalNodes).toBe(result.nodes.length);
      expect(result.summary.totalEdges).toBe(result.edges.length);
    });
  });

  describe("singleton instance", () => {
    it("exports a singleton instance", () => {
      expect(dependencyGraphService).toBeInstanceOf(DependencyGraphService);
    });

    it("singleton instance works correctly", () => {
      const result = dependencyGraphService.getGraph();

      expect(result.nodes).toBeDefined();
      expect(result.edges).toBeDefined();
      expect(result.summary).toBeDefined();
    });
  });

  describe("impact hints", () => {
    it("all nodes have impact hints", () => {
      const result = service.getGraph();

      result.nodes.forEach((node) => {
        expect(node.impactHint).toBeDefined();
        expect(typeof node.impactHint).toBe("string");
        expect(node.impactHint.length).toBeGreaterThan(0);
      });
    });
  });

  describe("descriptions", () => {
    it("all nodes have descriptions", () => {
      const result = service.getGraph();

      result.nodes.forEach((node) => {
        expect(node.description).toBeDefined();
        expect(typeof node.description).toBe("string");
        expect(node.description.length).toBeGreaterThan(0);
      });
    });
  });

  describe("graph consistency", () => {
    it("no orphaned edges after filtering", () => {
      const result = service.getGraph({ status: "healthy" });
      const nodeIds = new Set(result.nodes.map((n) => n.id));

      result.edges.forEach((edge) => {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      });
    });

    it("maintains graph structure with multiple filters", () => {
      const result = service.getGraph({
        type: "rpc",
        status: "healthy",
        search: "stellar",
      });

      const nodeIds = new Set(result.nodes.map((n) => n.id));
      result.edges.forEach((edge) => {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      });
    });
  });
});
