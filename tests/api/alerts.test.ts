import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { buildServer } from "../../src/index.js";
import type { FastifyInstance } from "fastify";

vi.mock("../../src/api/middleware/auth.js", () => ({
  authMiddleware: () => async () => {},
}));

const alertServiceMocks = vi.hoisted(() => ({
  getRulesForOwner: vi.fn(),
  createRule: vi.fn(),
  getRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  setRuleActive: vi.fn(),
  getRecentAlerts: vi.fn(),
  getAlertHistory: vi.fn(),
  getAlertsForRule: vi.fn(),
  getAlertStats: vi.fn(),
  dryRunAlert: vi.fn(),
  bulkCreateRules: vi.fn(),
  bulkUpdateRules: vi.fn(),
  bulkDeleteRules: vi.fn(),
}));

vi.mock("../../src/services/alert.service.js", () => ({
  AlertService: class AlertService {
    getRulesForOwner = alertServiceMocks.getRulesForOwner;
    createRule = alertServiceMocks.createRule;
    getRule = alertServiceMocks.getRule;
    updateRule = alertServiceMocks.updateRule;
    deleteRule = alertServiceMocks.deleteRule;
    setRuleActive = alertServiceMocks.setRuleActive;
    getRecentAlerts = alertServiceMocks.getRecentAlerts;
    getAlertHistory = alertServiceMocks.getAlertHistory;
    getAlertsForRule = alertServiceMocks.getAlertsForRule;
    getAlertStats = alertServiceMocks.getAlertStats;
    dryRunAlert = alertServiceMocks.dryRunAlert;
    bulkCreateRules = alertServiceMocks.bulkCreateRules;
    bulkUpdateRules = alertServiceMocks.bulkUpdateRules;
    bulkDeleteRules = alertServiceMocks.bulkDeleteRules;
  },
}));

const TEST_OWNER = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const TEST_RULE_ID = "550e8400-e29b-41d4-a716-446655440000";

const mockCondition = {
  metric: "health_score",
  alertType: "health_score_drop" as const,
  compareOp: "lt" as const,
  threshold: 80,
};

const mockRule = {
  id: TEST_RULE_ID,
  ownerAddress: TEST_OWNER,
  name: "USDC health drop",
  assetCode: "USDC",
  conditions: [mockCondition],
  conditionOp: "AND",
  priority: "high",
  cooldownSeconds: 300,
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("Alerts API", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    Object.values(alertServiceMocks).forEach((mock) => mock.mockReset());
  });

  describe("GET /api/v1/alerts/rules", () => {
    it("returns list of rules for a valid owner", async () => {
      alertServiceMocks.getRulesForOwner.mockResolvedValue([mockRule]);

      const response = await server.inject({
        method: "GET",
        url: `/api/v1/alerts/rules?owner=${TEST_OWNER}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("rules");
      expect(Array.isArray(body.rules)).toBe(true);
      expect(alertServiceMocks.getRulesForOwner).toHaveBeenCalledWith(TEST_OWNER);
    });

    it("returns 400 when owner query param is missing", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/rules",
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /api/v1/alerts/rules", () => {
    it("creates a rule and returns 201", async () => {
      alertServiceMocks.createRule.mockResolvedValue(mockRule);

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/alerts/rules",
        payload: {
          ownerAddress: TEST_OWNER,
          name: "USDC health drop",
          assetCode: "USDC",
          conditions: [mockCondition],
          conditionOp: "AND",
          priority: "high",
          cooldownSeconds: 300,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("rule");
    });

    it("returns 400 when required fields are missing", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/alerts/rules",
        payload: {
          ownerAddress: TEST_OWNER,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when ownerAddress is missing", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/alerts/rules",
        payload: {
          name: "USDC health drop",
          assetCode: "USDC",
          conditions: [{ metric: "health_score", operator: "lt", threshold: 80 }],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/v1/alerts/rules/:ruleId", () => {
    it("returns a single rule by ID", async () => {
      alertServiceMocks.getRule.mockResolvedValue(mockRule);

      const response = await server.inject({
        method: "GET",
        url: `/api/v1/alerts/rules/${TEST_RULE_ID}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("rule");
      expect(alertServiceMocks.getRule).toHaveBeenCalledWith(TEST_RULE_ID);
    });

    it("returns 404 when rule does not exist", async () => {
      alertServiceMocks.getRule.mockResolvedValue(null);

      const response = await server.inject({
        method: "GET",
        url: `/api/v1/alerts/rules/${TEST_RULE_ID}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("PATCH /api/v1/alerts/rules/:ruleId", () => {
    it("updates a rule and returns 200", async () => {
      alertServiceMocks.updateRule.mockResolvedValue({ ...mockRule, name: "Updated name" });

      const response = await server.inject({
        method: "PATCH",
        url: `/api/v1/alerts/rules/${TEST_RULE_ID}`,
        payload: {
          ownerAddress: TEST_OWNER,
          name: "Updated name",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("rule");
    });

    it("returns 404 when rule does not exist", async () => {
      alertServiceMocks.updateRule.mockResolvedValue(null);

      const response = await server.inject({
        method: "PATCH",
        url: `/api/v1/alerts/rules/${TEST_RULE_ID}`,
        payload: {
          ownerAddress: TEST_OWNER,
          name: "Updated name",
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/v1/alerts/rules/:ruleId", () => {
    it("deletes a rule and returns 204", async () => {
      alertServiceMocks.deleteRule.mockResolvedValue(true);

      const response = await server.inject({
        method: "DELETE",
        url: `/api/v1/alerts/rules/${TEST_RULE_ID}`,
        payload: {
          ownerAddress: TEST_OWNER,
        },
      });

      expect(response.statusCode).toBe(204);
    });

    it("returns 404 when rule does not exist", async () => {
      alertServiceMocks.deleteRule.mockResolvedValue(false);

      const response = await server.inject({
        method: "DELETE",
        url: `/api/v1/alerts/rules/${TEST_RULE_ID}`,
        payload: {
          ownerAddress: TEST_OWNER,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("returns 400 when ownerAddress is missing", async () => {
      const response = await server.inject({
        method: "DELETE",
        url: `/api/v1/alerts/rules/${TEST_RULE_ID}`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/v1/alerts/history", () => {
    it("returns paginated alert history", async () => {
      const mockEvents = [{ id: "evt1", ruleId: TEST_RULE_ID, firedAt: new Date().toISOString() }];
      alertServiceMocks.getRecentAlerts.mockResolvedValue(mockEvents);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/history",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("data");
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("GET /api/v1/alerts/history/:assetCode", () => {
    it("returns alert history for a specific asset", async () => {
      const mockEvents = [{ id: "evt1", assetCode: "USDC", firedAt: new Date().toISOString() }];
      alertServiceMocks.getAlertHistory.mockResolvedValue(mockEvents);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/history/USDC",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("events");
      expect(Array.isArray(body.events)).toBe(true);
      expect(alertServiceMocks.getAlertHistory).toHaveBeenCalledWith("USDC", expect.any(Number));
    });
  });

  describe("GET /api/v1/alerts/stats", () => {
    it("returns alert statistics for a valid owner", async () => {
      const mockStats = { totalRules: 3, activeRules: 2, totalFired: 10, lastFiredAt: null };
      alertServiceMocks.getAlertStats.mockResolvedValue(mockStats);

      const response = await server.inject({
        method: "GET",
        url: `/api/v1/alerts/stats?owner=${TEST_OWNER}`,
      });

      expect(response.statusCode).toBe(200);
      expect(alertServiceMocks.getAlertStats).toHaveBeenCalledWith(TEST_OWNER);
    });

    it("returns 400 when owner is missing", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/stats",
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/v1/alerts/recent", () => {
    it("returns recent alert events", async () => {
      const mockEvents = [{ id: "evt1", ruleId: TEST_RULE_ID, firedAt: new Date().toISOString() }];
      alertServiceMocks.getRecentAlerts.mockResolvedValue(mockEvents);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/recent",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("events");
      expect(Array.isArray(body.events)).toBe(true);
    });
  });

  describe("GET /api/v1/alerts/rules/:ruleId/events", () => {
    it("returns events for a specific rule", async () => {
      const mockEvents = [{ id: "evt1", ruleId: TEST_RULE_ID, firedAt: new Date().toISOString() }];
      alertServiceMocks.getAlertsForRule.mockResolvedValue(mockEvents);

      const response = await server.inject({
        method: "GET",
        url: `/api/v1/alerts/rules/${TEST_RULE_ID}/events`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("events");
      expect(Array.isArray(body.events)).toBe(true);
      expect(alertServiceMocks.getAlertsForRule).toHaveBeenCalledWith(
        TEST_RULE_ID,
        expect.any(Number)
      );
    });
  });
});
