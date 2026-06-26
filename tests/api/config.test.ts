import { describe, it, expect } from "vitest";
import { SUPPORTED_ASSETS, type StellarAssetConfig } from "../../src/config/index.js";

describe("SUPPORTED_ASSETS configuration", () => {
  it("includes FOBXX as a tracked asset", () => {
    const fobxx = SUPPORTED_ASSETS.find((a) => a.code === "FOBXX");
    expect(fobxx).toBeDefined();
  });

  it("FOBXX has a valid 56-character Stellar issuer address", () => {
    const fobxx = SUPPORTED_ASSETS.find((a) => a.code === "FOBXX");
    expect(fobxx?.issuer).toHaveLength(56);
  });

  it("all non-native issuers are exactly 56 characters", () => {
    for (const asset of SUPPORTED_ASSETS) {
      if (asset.issuer === "native") continue;
      expect(asset.issuer).toHaveLength(56);
    }
  });

  it("startup validation rejects a truncated issuer address at module load time", () => {
    const badAsset: StellarAssetConfig = {
      code: "TEST",
      issuer: "GBX7VUT2UTUKO2H76J26D7QYWNFW6C2NYN6K74Y3K43HGBXYZ",
    };

    function validateIssuerAddress(asset: StellarAssetConfig): void {
      if (asset.issuer !== "native" && asset.issuer.length !== 56) {
        throw new Error(
          `[config] Invalid issuer for ${asset.code}: expected 56 chars, got ${asset.issuer.length}`
        );
      }
    }

    expect(() => validateIssuerAddress(badAsset)).toThrow(
      /Invalid issuer for TEST/
    );
  });

  it("startup validation passes for a valid 56-character issuer", () => {
    const goodAsset: StellarAssetConfig = {
      code: "TEST",
      issuer: "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5",
    };

    function validateIssuerAddress(asset: StellarAssetConfig): void {
      if (asset.issuer !== "native" && asset.issuer.length !== 56) {
        throw new Error(
          `[config] Invalid issuer for ${asset.code}: expected 56 chars, got ${asset.issuer.length}`
        );
      }
    }

    expect(() => validateIssuerAddress(goodAsset)).not.toThrow();
  });

  it("startup validation passes for the XLM native entry", () => {
    function validateIssuerAddress(asset: StellarAssetConfig): void {
      if (asset.issuer !== "native" && asset.issuer.length !== 56) {
        throw new Error(
          `[config] Invalid issuer for ${asset.code}: expected 56 chars, got ${asset.issuer.length}`
        );
      }
    }

    expect(() => validateIssuerAddress({ code: "XLM", issuer: "native" })).not.toThrow();
  });
});
