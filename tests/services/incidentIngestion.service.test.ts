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

vi.mock("../../src/services/enrichment/index.js", () => ({
  enrichmentPipelineService: {
    enrich: vi.fn(async () => ({
      metadata: { provider: "github", sourceHost: "github.com" },
      tags: ["source:github", "severity:high", "asset:usdc"],
      derivedFields: { normalizedAssetCode: "USDC", priorityScore: 85 },
      validation: { valid: true, issues: [] },
      attempts: 1,
      record: {},
    })),
  },
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

describe("IncidentIngestionService.ingest", () => {
  it("persists enrichment fields before inserting an incident", async () => {
    const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const incidentRow = {
      id: "incident-1",
      bridge_id: "wormhole",
      asset_code: "USDC",
      severity: "high",
      status: "open",
      title: "Liquidity drift detected",
      description: "Pool balance diverged beyond threshold",
      source_url: "https://github.com/StellaBridge/Bridge-Watch/issues/1",
      source_type: "github",
      source_external_id: "evt-123",
      source_repository: "StellaBridge/Bridge-Watch",
      source_repo_avatar_url: null,
      source_actor: "bridge-bot",
      source_attribution: "{}",
      enrichment_metadata: "{}",
      enrichment_tags: ["source:github"],
      derived_fields: "{}",
      enrichment_validation: "{}",
      requires_manual_review: false,
      ingestion_attempt_count: 1,
      last_ingestion_error: null,
      normalized_fingerprint: "a".repeat(64),
      follow_up_actions: "[]",
      occurred_at: new Date("2026-04-25T10:30:00.000Z"),
      resolved_at: null,
      created_at: new Date("2026-04-25T10:31:00.000Z"),
      updated_at: new Date("2026-04-25T10:31:00.000Z"),
    };

    const db = (table: string) => {
      const chain = {
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserts.push({ table, payload });
          return chain;
        }),
        returning: vi.fn().mockResolvedValue([incidentRow]),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue([]),
      };
      return chain;
    };

    const { getDatabase } = await import("../../src/database/connection.js");
    vi.mocked(getDatabase).mockReturnValue(db as any);
    const service = new IncidentIngestionService();

    await service.ingest({
      sourceType: "github",
      externalId: "evt-123",
      bridgeId: "wormhole",
      assetCode: "USDC",
      severity: "sev1",
      title: "Liquidity drift detected",
      description: "Pool balance diverged beyond threshold",
      sourceUrl: "https://github.com/StellaBridge/Bridge-Watch/issues/1",
      occurredAt: "2026-04-25T10:30:00.000Z",
    });

    const incidentInsert = inserts.find((insert) => insert.table === "bridge_incidents");
    expect(incidentInsert?.payload).toMatchObject({
      enrichment_metadata: JSON.stringify({
        provider: "github",
        sourceHost: "github.com",
        rawMetadata: {},
      }),
      enrichment_tags: ["source:github", "severity:high", "asset:usdc"],
      derived_fields: JSON.stringify({ normalizedAssetCode: "USDC", priorityScore: 85 }),
      enrichment_validation: JSON.stringify({ valid: true, issues: [], attempts: 1 }),
    });
  });
});
