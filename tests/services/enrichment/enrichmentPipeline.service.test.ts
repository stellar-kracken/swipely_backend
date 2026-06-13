import { describe, expect, it, vi } from "vitest";
import { EnrichmentPipelineService } from "../../../src/services/enrichment/enrichmentPipeline.service.js";
import type { EnrichmentProviderAdapter } from "../../../src/services/enrichment/types.js";

function retryPolicyStub() {
  return {
    getPolicy: vi.fn(() => ({
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 1,
      backoffMultiplier: 1,
      jitterRatio: 0,
    })),
    classifyFailure: vi.fn(() => "transient"),
    isRetryable: vi.fn(() => true),
    recordRetryMetric: vi.fn(),
    getDelayMs: vi.fn(() => 1),
  };
}

describe("EnrichmentPipelineService", () => {
  it("applies incident metadata, tags, and derived fields", async () => {
    const service = new EnrichmentPipelineService(undefined, retryPolicyStub() as any);

    const result = await service.enrich({
      recordType: "incident",
      provider: "github",
      data: {
        sourceType: "github",
        sourceExternalId: "evt-1",
        bridgeId: "wormhole",
        assetCode: "USDC",
        severity: "high",
        sourceUrl: "https://github.com/StellaBridge/Bridge-Watch/issues/1",
        occurredAt: "2026-04-25T10:30:00.000Z",
        followUpActions: ["Verify reserves"],
      },
    });

    expect(result.metadata).toMatchObject({
      provider: "github",
      recordType: "incident",
      sourceType: "github",
      sourceHost: "github.com",
      severityWeight: 80,
    });
    expect(result.tags).toEqual(expect.arrayContaining([
      "asset:stablecoin",
      "asset:usdc",
      "bridge:wormhole",
      "severity:high",
      "source:github",
    ]));
    expect(result.derivedFields).toMatchObject({
      normalizedAssetCode: "USDC",
      priorityScore: 85,
      riskBand: "elevated",
      sourceHost: "github.com",
    });
    expect(result.validation.valid).toBe(true);
  });

  it("retries retryable provider adapter failures", async () => {
    const retry = retryPolicyStub();
    const adapter: EnrichmentProviderAdapter = {
      name: "flaky",
      supports: () => true,
      enrich: vi.fn()
        .mockRejectedValueOnce(new Error("temporary timeout"))
        .mockResolvedValueOnce({ tags: ["source:webhook"] }),
    };
    const service = new EnrichmentPipelineService([adapter], retry as any);

    const result = await service.enrich({
      recordType: "incident",
      provider: "webhook",
      data: {},
    });

    expect(adapter.enrich).toHaveBeenCalledTimes(2);
    expect(retry.recordRetryMetric).toHaveBeenCalledWith(
      "enrichment.flaky",
      "scheduled",
      1,
      "transient",
    );
    expect(result.tags).toEqual(["source:webhook"]);
    expect(result.attempts).toBe(2);
  });
});
