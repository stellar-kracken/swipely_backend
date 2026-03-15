import { describe, it, expect } from "vitest";
import { HealthService } from "../../src/services/health.service.js";

describe("HealthService", () => {
  const healthService = new HealthService();

  describe("getHealthScore", () => {
    it("should return null when no data is available", async () => {
      const result = await healthService.getHealthScore("USDC");
      expect(result).toBeNull();
    });
  });

  describe("getHealthHistory", () => {
    it("should return an empty array when no history exists", async () => {
      const result = await healthService.getHealthHistory("USDC", 30);
      expect(result).toEqual([]);
    });
  });

  describe("computeAllHealthScores", () => {
    it("should return an empty array when no assets are monitored", async () => {
      const result = await healthService.computeAllHealthScores();
      expect(result).toEqual([]);
    });
  });
});
