import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { OwnershipMatrixService } from "../../src/services/ownershipMatrix.service.js";

// Mock dependencies
const mockDb = {
  transaction: vi.fn(),
  where: vi.fn(),
  first: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  returning: vi.fn(),
  join: vi.fn(),
  select: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  offset: vi.fn(),
  count: vi.fn(),
  whereIn: vi.fn(),
  fn: { now: vi.fn(() => new Date()) },
};

const mockAuditService = {
  log: vi.fn(),
  query: vi.fn(),
};

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockDb,
}));

vi.mock("../../src/services/audit.service.js", () => ({
  auditService: mockAuditService,
}));

describe("OwnershipMatrixService", () => {
  let service: OwnershipMatrixService;

  beforeEach(() => {
    service = new OwnershipMatrixService();
    vi.clearAllMocks();

    // Setup default mock chain
    mockDb.where.mockReturnThis();
    mockDb.join.mockReturnThis();
    mockDb.select.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockReturnThis();
    mockDb.count.mockReturnThis();
    mockDb.whereIn.mockReturnThis();
    mockDb.insert.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.returning.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("assignOwner", () => {
    it("should create ownership record and audit log entry for new assignment", async () => {
      const alertId = "alert-123";
      const ownerId = "owner-456";
      const ownerType = "user";
      const actorId = "actor-789";

      const mockAlert = { id: alertId, name: "Test Alert" };
      const mockOwnership = {
        id: "ownership-1",
        alert_id: alertId,
        owner_type: ownerType,
        owner_id: ownerId,
        created_by: actorId,
        created_at: new Date(),
      };

      mockDb.transaction.mockImplementation(async (callback) => {
        const trx = {
          ...mockDb,
          where: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValueOnce(null), // No existing ownership
          insert: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([mockOwnership]),
        };
        return callback(trx);
      });

      mockDb.where.mockReturnThis();
      mockDb.first.mockResolvedValue(mockAlert);

      const result = await service.assignOwner(alertId, ownerId, ownerType, actorId);

      expect(result.alertId).toBe(alertId);
      expect(result.ownerId).toBe(ownerId);
      expect(result.ownerType).toBe(ownerType);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "alert.ownership_assigned",
          actorId,
          resourceType: "alert_ownership",
          resourceId: alertId,
        })
      );
    });

    it("should record previous owner in audit log for transfer", async () => {
      const alertId = "alert-123";
      const newOwnerId = "new-owner";
      const ownerType = "user";
      const actorId = "actor-789";

      const mockAlert = { id: alertId, name: "Test Alert" };
      const existingOwnership = {
        id: "ownership-1",
        alert_id: alertId,
        owner_type: "user",
        owner_id: "old-owner",
        created_by: "old-actor",
        created_at: new Date(),
      };

      const updatedOwnership = {
        ...existingOwnership,
        owner_id: newOwnerId,
        created_by: actorId,
      };

      mockDb.transaction.mockImplementation(async (callback) => {
        const trx = {
          ...mockDb,
          where: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValueOnce(existingOwnership),
          update: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([updatedOwnership]),
        };
        return callback(trx);
      });

      mockDb.where.mockReturnThis();
      mockDb.first.mockResolvedValue(mockAlert);

      await service.assignOwner(alertId, newOwnerId, ownerType, actorId);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "alert.ownership_transferred",
          before: {
            ownerType: "user",
            ownerId: "old-owner",
          },
          after: {
            ownerType,
            ownerId: newOwnerId,
          },
        })
      );
    });

    it("should reject invalid alertId", async () => {
      const alertId = "invalid-alert";

      mockDb.where.mockReturnThis();
      mockDb.first.mockResolvedValue(null);

      await expect(
        service.assignOwner(alertId, "owner", "user", "actor")
      ).rejects.toThrow("Alert not found");
    });
  });

  describe("addEscalationContact", () => {
    it("should add contact at correct order", async () => {
      const alertId = "alert-123";
      const contactUserId = "contact-456";
      const order = 2;
      const actorId = "actor-789";

      const mockAlert = { id: alertId, name: "Test Alert" };
      const mockContact = {
        id: "contact-1",
        alert_id: alertId,
        contact_user_id: contactUserId,
        order,
        created_by: actorId,
        created_at: new Date(),
      };

      mockDb.transaction.mockImplementation(async (callback) => {
        const trx = {
          ...mockDb,
          where: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValueOnce(null), // No existing contact
          insert: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([mockContact]),
        };
        return callback(trx);
      });

      mockDb.where.mockReturnThis();
      mockDb.first.mockResolvedValue(mockAlert);

      const result = await service.addEscalationContact(
        alertId,
        contactUserId,
        order,
        actorId
      );

      expect(result.order).toBe(order);
      expect(result.contactUserId).toBe(contactUserId);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "alert.escalation_added",
          resourceType: "escalation_contact",
        })
      );
    });

    it("should reject duplicate contact", async () => {
      const alertId = "alert-123";
      const contactUserId = "contact-456";

      const mockAlert = { id: alertId, name: "Test Alert" };
      const existingContact = {
        id: "contact-1",
        alert_id: alertId,
        contact_user_id: contactUserId,
      };

      mockDb.transaction.mockImplementation(async (callback) => {
        const trx = {
          ...mockDb,
          where: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValueOnce(existingContact),
        };
        return callback(trx);
      });

      mockDb.where.mockReturnThis();
      mockDb.first.mockResolvedValue(mockAlert);

      await expect(
        service.addEscalationContact(alertId, contactUserId, 1, "actor")
      ).rejects.toThrow("Contact already exists");
    });
  });

  describe("getEscalationContacts", () => {
    it("should return contacts in ascending order", async () => {
      const alertId = "alert-123";
      const mockContacts = [
        {
          id: "c1",
          alert_id: alertId,
          contact_user_id: "user1",
          order: 1,
          created_by: "actor",
          created_at: new Date(),
        },
        {
          id: "c2",
          alert_id: alertId,
          contact_user_id: "user2",
          order: 2,
          created_by: "actor",
          created_at: new Date(),
        },
      ];

      mockDb.where.mockReturnThis();
      mockDb.orderBy.mockResolvedValue(mockContacts);

      const result = await service.getEscalationContacts(alertId);

      expect(result).toHaveLength(2);
      expect(result[0].order).toBe(1);
      expect(result[1].order).toBe(2);
    });
  });

  describe("getAuditHistory", () => {
    it("should return entries in reverse chronological order", async () => {
      const alertId = "alert-123";
      const mockEntries = [
        {
          id: "audit-1",
          action: "alert.ownership_assigned",
          actorId: "actor1",
          before: null,
          after: { ownerId: "owner1" },
          metadata: {},
          createdAt: new Date("2026-01-02"),
        },
        {
          id: "audit-2",
          action: "alert.escalation_added",
          actorId: "actor2",
          before: null,
          after: { contactUserId: "contact1" },
          metadata: {},
          createdAt: new Date("2026-01-01"),
        },
      ];

      mockAuditService.query.mockResolvedValue({
        entries: mockEntries,
        total: 2,
      });

      const result = await service.getAuditHistory(alertId, { page: 1, limit: 50 });

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].action).toBe("alert.ownership_assigned");
    });
  });

  describe("exportOwnershipMatrix", () => {
    it("should generate CSV with correct headers and rows", async () => {
      const mockData = [
        {
          alertId: "alert-1",
          alertName: "Alert 1",
          ownerType: "user" as const,
          ownerId: "owner-1",
          createdBy: "actor-1",
          createdAt: new Date("2026-01-01"),
          escalationContacts: [{ contactUserId: "contact-1", order: 1 }],
        },
      ];

      // Mock getOwnershipMatrix
      vi.spyOn(service, "getOwnershipMatrix").mockResolvedValue({
        data: mockData,
        meta: { total: 1, page: 1, limit: 10000, totalPages: 1 },
      });

      const csv = await service.exportOwnershipMatrix("csv", {});

      expect(csv).toContain("alert_id");
      expect(csv).toContain("alert_name");
      expect(csv).toContain("owner_type");
      expect(csv).toContain("alert-1");
      expect(csv).toContain("Alert 1");
    });

    it("should generate JSON matching getOwnershipMatrix shape", async () => {
      const mockData = [
        {
          alertId: "alert-1",
          alertName: "Alert 1",
          ownerType: "user" as const,
          ownerId: "owner-1",
          createdBy: "actor-1",
          createdAt: new Date("2026-01-01"),
          escalationContacts: [],
        },
      ];

      vi.spyOn(service, "getOwnershipMatrix").mockResolvedValue({
        data: mockData,
        meta: { total: 1, page: 1, limit: 10000, totalPages: 1 },
      });

      const json = await service.exportOwnershipMatrix("json", {});
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].alertId).toBe("alert-1");
    });
  });

  describe("searchOwnership", () => {
    it("should return results matching alert name, owner name, and team name", async () => {
      const query = "test";
      const mockResults = [
        {
          alert_id: "alert-1",
          alert_name: "Test Alert",
          owner_type: "user",
          owner_id: "owner-1",
          created_by: "actor-1",
          created_at: new Date(),
        },
      ];

      mockDb.where.mockReturnThis();
      mockDb.join.mockReturnThis();
      mockDb.select.mockReturnThis();
      mockDb.orderBy.mockReturnThis();
      mockDb.limit.mockReturnThis();
      mockDb.offset.mockResolvedValue(mockResults);

      mockDb.count.mockReturnThis();
      mockDb.first.mockResolvedValue({ count: 1 });

      mockDb.whereIn.mockReturnThis();
      mockDb.orderBy.mockResolvedValue([]);

      const result = await service.searchOwnership(query, { page: 1, limit: 50 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].alertName).toBe("Test Alert");
      expect(result.meta.total).toBe(1);
    });
  });
});
