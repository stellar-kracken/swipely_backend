import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { buildServer } from "../../src/index.js";
import type { FastifyInstance } from "fastify";

const mockService = {
  assignOwner: vi.fn(),
  getOwner: vi.fn(),
  getOwnershipMatrix: vi.fn(),
  addEscalationContact: vi.fn(),
  getEscalationContacts: vi.fn(),
  removeEscalationContact: vi.fn(),
  getAuditHistory: vi.fn(),
  exportOwnershipMatrix: vi.fn(),
  searchOwnership: vi.fn(),
};

vi.mock("../../src/services/ownershipMatrix.service.js", () => ({
  OwnershipMatrixService: class {
    assignOwner = mockService.assignOwner;
    getOwner = mockService.getOwner;
    getOwnershipMatrix = mockService.getOwnershipMatrix;
    addEscalationContact = mockService.addEscalationContact;
    getEscalationContacts = mockService.getEscalationContacts;
    removeEscalationContact = mockService.removeEscalationContact;
    getAuditHistory = mockService.getAuditHistory;
    exportOwnershipMatrix = mockService.exportOwnershipMatrix;
    searchOwnership = mockService.searchOwnership;
  },
}));

// Mock auth middleware to allow requests
vi.mock("../../src/api/middleware/auth.js", () => ({
  authMiddleware: () => async () => {
    // Allow all requests in tests
  },
}));

describe("Ownership Matrix API", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/v1/alerts/:alertId/ownership", () => {
    it("should assign ownership and return 200", async () => {
      const alertId = "alert-123";
      const mockOwnership = {
        id: "ownership-1",
        alertId,
        ownerType: "user",
        ownerId: "owner-456",
        createdBy: "actor-789",
        createdAt: new Date(),
      };

      mockService.assignOwner.mockResolvedValue(mockOwnership);

      const response = await server.inject({
        method: "POST",
        url: `/api/v1/alerts/${alertId}/ownership`,
        payload: {
          ownerId: "owner-456",
          ownerType: "user",
          actorId: "actor-789",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ownership.alertId).toBe(alertId);
      expect(mockService.assignOwner).toHaveBeenCalledWith(
        alertId,
        "owner-456",
        "user",
        "actor-789"
      );
    });

    it("should return 404 for invalid alert", async () => {
      mockService.assignOwner.mockRejectedValue(new Error("Alert not found"));

      const response = await server.inject({
        method: "POST",
        url: "/api/v1/alerts/invalid-alert/ownership",
        payload: {
          ownerId: "owner-456",
          ownerType: "user",
          actorId: "actor-789",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 400 for malformed request", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/alerts/alert-123/ownership",
        payload: {
          // Missing required fields
          ownerId: "owner-456",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/v1/alerts/:alertId/ownership", () => {
    it("should return current owner", async () => {
      const alertId = "alert-123";
      const mockOwnership = {
        id: "ownership-1",
        alertId,
        ownerType: "user",
        ownerId: "owner-456",
        createdBy: "actor-789",
        createdAt: new Date(),
      };

      mockService.getOwner.mockResolvedValue(mockOwnership);

      const response = await server.inject({
        method: "GET",
        url: `/api/v1/alerts/${alertId}/ownership`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ownership.alertId).toBe(alertId);
    });

    it("should return null for unowned alert", async () => {
      mockService.getOwner.mockResolvedValue(null);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/alert-123/ownership",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ownership).toBeNull();
    });
  });

  describe("GET /api/v1/ownership/matrix", () => {
    it("should return paginated ownership matrix", async () => {
      const mockResult = {
        data: [
          {
            alertId: "alert-1",
            alertName: "Alert 1",
            ownerType: "user",
            ownerId: "owner-1",
            createdBy: "actor-1",
            createdAt: new Date(),
            escalationContacts: [],
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        },
      };

      mockService.getOwnershipMatrix.mockResolvedValue(mockResult);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/ownership/matrix?page=1&limit=50",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.meta.total).toBe(1);
    });
  });

  describe("POST /api/v1/alerts/:alertId/escalation", () => {
    it("should add escalation contact and return 201", async () => {
      const alertId = "alert-123";
      const mockContact = {
        id: "contact-1",
        alertId,
        contactUserId: "contact-456",
        order: 1,
        createdBy: "actor-789",
        createdAt: new Date(),
      };

      mockService.addEscalationContact.mockResolvedValue(mockContact);

      const response = await server.inject({
        method: "POST",
        url: `/api/v1/alerts/${alertId}/escalation`,
        payload: {
          contactUserId: "contact-456",
          order: 1,
          actorId: "actor-789",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.contact.contactUserId).toBe("contact-456");
    });
  });

  describe("GET /api/v1/alerts/:alertId/escalation", () => {
    it("should return escalation contacts in order", async () => {
      const alertId = "alert-123";
      const mockContacts = [
        {
          id: "c1",
          alertId,
          contactUserId: "user1",
          order: 1,
          createdBy: "actor",
          createdAt: new Date(),
        },
        {
          id: "c2",
          alertId,
          contactUserId: "user2",
          order: 2,
          createdBy: "actor",
          createdAt: new Date(),
        },
      ];

      mockService.getEscalationContacts.mockResolvedValue(mockContacts);

      const response = await server.inject({
        method: "GET",
        url: `/api/v1/alerts/${alertId}/escalation`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.contacts).toHaveLength(2);
      expect(body.contacts[0].order).toBe(1);
    });
  });

  describe("DELETE /api/v1/alerts/:alertId/escalation/:contactUserId", () => {
    it("should remove escalation contact", async () => {
      mockService.removeEscalationContact.mockResolvedValue(true);

      const response = await server.inject({
        method: "DELETE",
        url: "/api/v1/alerts/alert-123/escalation/contact-456",
        payload: {
          actorId: "actor-789",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it("should return 404 if contact not found", async () => {
      mockService.removeEscalationContact.mockResolvedValue(false);

      const response = await server.inject({
        method: "DELETE",
        url: "/api/v1/alerts/alert-123/escalation/contact-456",
        payload: {
          actorId: "actor-789",
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/v1/alerts/:alertId/ownership/history", () => {
    it("should return paginated audit history", async () => {
      const mockHistory = {
        entries: [
          {
            id: "audit-1",
            action: "alert.ownership_assigned",
            actorId: "actor-1",
            before: null,
            after: { ownerId: "owner-1" },
            metadata: {},
            createdAt: new Date(),
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        },
      };

      mockService.getAuditHistory.mockResolvedValue(mockHistory);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/alert-123/ownership/history?page=1&limit=50",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.entries).toHaveLength(1);
    });
  });

  describe("GET /api/v1/ownership/export", () => {
    it("should export CSV with correct Content-Type header", async () => {
      const mockCsv = "alert_id,alert_name,owner_type\nalert-1,Alert 1,user";
      mockService.exportOwnershipMatrix.mockResolvedValue(mockCsv);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/ownership/export?format=csv",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/csv");
      expect(response.headers["content-disposition"]).toContain("attachment");
      expect(response.body).toContain("alert_id");
    });

    it("should export JSON with correct Content-Type header", async () => {
      const mockJson = JSON.stringify([{ alertId: "alert-1" }]);
      mockService.exportOwnershipMatrix.mockResolvedValue(mockJson);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/ownership/export?format=json",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
    });
  });

  describe("GET /api/v1/ownership/search", () => {
    it("should return paginated search results", async () => {
      const mockResult = {
        data: [
          {
            alertId: "alert-1",
            alertName: "Test Alert",
            ownerType: "user",
            ownerId: "owner-1",
            createdBy: "actor-1",
            createdAt: new Date(),
            escalationContacts: [],
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        },
      };

      mockService.searchOwnership.mockResolvedValue(mockResult);

      const response = await server.inject({
        method: "GET",
        url: "/api/v1/ownership/search?q=test&page=1&limit=50",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
    });

    it("should return 400 for missing query parameter", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/v1/ownership/search",
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("Audit History Immutability", () => {
    it("should not allow modification of audit log entries", async () => {
      // The audit service does not expose update or delete methods
      // This test verifies that no endpoint allows modification

      const mockHistory = {
        entries: [
          {
            id: "audit-1",
            action: "alert.ownership_assigned",
            actorId: "actor-1",
            before: null,
            after: { ownerId: "owner-1" },
            metadata: {},
            createdAt: new Date(),
          },
        ],
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      };

      mockService.getAuditHistory.mockResolvedValue(mockHistory);

      // Verify we can only read, not modify
      const getResponse = await server.inject({
        method: "GET",
        url: "/api/v1/alerts/alert-123/ownership/history",
      });

      expect(getResponse.statusCode).toBe(200);

      // Attempt to modify (should fail - no such endpoint exists)
      const putResponse = await server.inject({
        method: "PUT",
        url: "/api/v1/alerts/alert-123/ownership/history/audit-1",
        payload: { action: "modified" },
      });

      expect(putResponse.statusCode).toBe(404); // Route not found

      const deleteResponse = await server.inject({
        method: "DELETE",
        url: "/api/v1/alerts/alert-123/ownership/history/audit-1",
      });

      expect(deleteResponse.statusCode).toBe(404); // Route not found
    });
  });
});
