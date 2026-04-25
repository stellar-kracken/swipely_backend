import { describe, expect, it, vi } from "vitest";
import { IncidentIngestionService } from "../../src/services/incidentIngestion.service.js";

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: vi.fn(() => {
    const chain = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue([]),
    };

    const db = vi.fn(() => chain);
    return db;
  }),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("IncidentIngestionService.normalize", () => {
  const service = new IncidentIngestionService();

  it("maps source payload into normalized incident format", () => {
    const normalized = service.normalize({
      sourceType: "github",
      externalId: "evt-123",
      bridgeId: "wormhole",
      assetCode: "USDC",
      severity: "sev1",
      title: "Liquidity drift detected",
      description: "Pool balance diverged beyond threshold",
      sourceUrl: "https://github.com/StellaBridge/Bridge-Watch/issues/1",
      repository: "StellaBridge/Bridge-Watch",
      repoAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      actor: "bridge-bot",
      occurredAt: "2026-04-25T10:30:00.000Z",
      followUpActions: ["Validate pool", "Notify incident channel"],
    });

    expect(normalized.sourceType).toBe("github");
    expect(normalized.sourceExternalId).toBe("evt-123");
    expect(normalized.severity).toBe("high");
    expect(normalized.sourceRepository).toBe("StellaBridge/Bridge-Watch");
    expect(normalized.sourceRepoAvatarUrl).toContain("avatars.githubusercontent.com");
    expect(normalized.requiresManualReview).toBe(false);
    expect(normalized.normalizedFingerprint).toHaveLength(64);
  });

  it("marks incomplete payloads for manual review", () => {
    const normalized = service.normalize({
      sourceType: "webhook",
      severity: "critical",
      description: "Only description was provided",
    });

    expect(normalized.requiresManualReview).toBe(true);
    expect(normalized.reviewReason).toContain("missing_bridge_id");
    expect(normalized.reviewReason).toContain("missing_title");
  });
});
