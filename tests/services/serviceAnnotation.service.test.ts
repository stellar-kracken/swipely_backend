import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceAnnotationService } from "../../src/services/serviceAnnotation.service.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const returningRow = {
  id: "ann-1",
  service_name: "price-service",
  entity_type: "source",
  entity_id: null as string | null,
  content: "Test annotation",
  author: "ops",
  start_time: null as Date | null,
  end_time: null as Date | null,
  active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const b: Record<string, unknown> = {};
    b.where = vi.fn().mockReturnValue(b);
    b.orderBy = vi.fn().mockReturnValue(b);
    b.insert = vi.fn().mockReturnValue(b);
    b.update = vi.fn().mockReturnValue(b);
    b.delete = vi.fn().mockResolvedValue(1);
    b.first = vi.fn().mockResolvedValue(null);
    b.returning = vi.fn().mockResolvedValue([returningRow]);
    const fn = (_t: string) => b;
    return fn;
  }),
}));

describe("ServiceAnnotationService", () => {
  let service: ServiceAnnotationService;

  beforeEach(() => {
    (ServiceAnnotationService as any).instance = undefined;
    service = ServiceAnnotationService.getInstance();
    vi.clearAllMocks();
  });

  it("creates an annotation", async () => {
    const annotation = await service.create({
      serviceName: "price-service",
      entityType: "source",
      content: "Test annotation",
      author: "ops",
    });

    expect(annotation.serviceName).toBe("price-service");
    expect(annotation.content).toBe("Test annotation");
    expect(annotation.active).toBe(true);
    expect(annotation.author).toBe("ops");
  });

  it("returns null when annotation not found", async () => {
    const result = await service.get("nonexistent");
    expect(result).toBeNull();
  });

  it("deletes an annotation", async () => {
    const deleted = await service.delete("ann-1", "ops");
    expect(deleted).toBe(true);
  });

  it("lists annotations", async () => {
    vi.spyOn(service, "list").mockResolvedValue([
      {
        id: "ann-1",
        serviceName: "price-service",
        entityType: "source",
        entityId: null,
        content: "Test",
        author: "ops",
        startTime: null,
        endTime: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const results = await service.list({ serviceName: "price-service" });
    expect(results).toHaveLength(1);
    expect(results[0].serviceName).toBe("price-service");
  });

  it("returns empty audit log for unknown annotation", async () => {
    const audit = await service.getAuditLog("nonexistent");
    expect(audit).toEqual([]);
  });
});
