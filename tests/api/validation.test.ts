import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ValidationService, type ValidationContext } from "../../src/services/validation.service.js";
import { config } from "../../src/config/index.js";

describe("Data Validation Service", () => {
  let validationService: ValidationService;

  beforeEach(() => {
    validationService = new ValidationService();
    validationService.resetMetrics();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Asset Validation", () => {
    const validAsset = {
      symbol: "USDC",
      name: "USD Coin",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      asset_type: "credit_alphanum4",
      bridge_provider: "Circle",
      source_chain: "Ethereum",
      is_active: true,
    };

    it("should validate a valid asset", async () => {
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(validAsset, "asset", context);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.metadata.dataType).toBe("asset");
      expect(result.metadata.rulesApplied).toContain("schema_validation");
    });

    it("should reject asset with missing symbol", async () => {
      const invalidAsset = { ...validAsset, symbol: "" };
      
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidAsset, "asset", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "symbol")).toBe(true);
    });

    it("should reject asset with invalid symbol format", async () => {
      const invalidAsset = { ...validAsset, symbol: "usdc-lowercase" };
      
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidAsset, "asset", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "symbol")).toBe(true);
    });

    it("should reject asset with invalid issuer format", async () => {
      const invalidAsset = { ...validAsset, issuer: "invalid-address" };
      
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidAsset, "asset", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "issuer")).toBe(true);
    });

    it("should reject native asset with issuer", async () => {
      const invalidAsset = {
        ...validAsset,
        asset_type: "native",
        issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      };
      
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidAsset, "asset", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === "NATIVE_ASSET_WITH_ISSUER")).toBe(true);
    });

    it("should reject non-native asset without issuer", async () => {
      const invalidAsset = { ...validAsset, issuer: null };
      
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidAsset, "asset", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === "NON_NATIVE_WITHOUT_ISSUER")).toBe(true);
    });

    it("should normalize asset symbol to uppercase", async () => {
      const assetWithLowercase = { ...validAsset, symbol: "usdc" };
      
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(assetWithLowercase, "asset", context);

      expect(result.isValid).toBe(true);
      expect(result.normalizedData.symbol).toBe("USDC");
    });

    it("should allow bridge provider without source chain (with warning)", async () => {
      const assetWithoutSource = { ...validAsset, source_chain: null };
      
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(assetWithoutSource, "asset", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === "BRIDGE_PROVIDER_WITHOUT_SOURCE_CHAIN")).toBe(true);
    });
  });

  describe("Bridge Validation", () => {
    const validBridge = {
      name: "Ethereum Bridge",
      source_chain: "Ethereum",
      status: "healthy",
      total_value_locked: "1000000.00",
      supply_on_stellar: "500000.00",
      supply_on_source: "500000.00",
      is_active: true,
    };

    it("should validate a valid bridge", async () => {
      const context: ValidationContext = {
        dataType: "bridge",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(validBridge, "bridge", context);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject bridge with negative supply", async () => {
      const invalidBridge = { ...validBridge, supply_on_stellar: "-100" };
      
      const context: ValidationContext = {
        dataType: "bridge",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidBridge, "bridge", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "supply_on_stellar")).toBe(true);
    });

    it("should warn about healthy bridge with zero supply", async () => {
      const bridgeWithZeroSupply = {
        ...validBridge,
        status: "healthy",
        supply_on_stellar: "0",
        supply_on_source: "0",
      };
      
      const context: ValidationContext = {
        dataType: "bridge",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(bridgeWithZeroSupply, "bridge", context);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.code === "HEALTHY_BRIDGE_ZERO_SUPPLY")).toBe(true);
    });

    it("should warn about excessive TVL", async () => {
      const bridgeWithHighTvl = {
        ...validBridge,
        total_value_locked: "2000000000.00",
      };
      
      const context: ValidationContext = {
        dataType: "bridge",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(bridgeWithHighTvl, "bridge", context);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.code === "TVL_EXCESSIVE")).toBe(true);
    });

    it("should reject invalid status value", async () => {
      const invalidBridge = { ...validBridge, status: "invalid_status" };
      
      const context: ValidationContext = {
        dataType: "bridge",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidBridge, "bridge", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "status")).toBe(true);
    });
  });

  describe("Price Record Validation", () => {
    const validPriceRecord = {
      time: new Date(),
      symbol: "USDC",
      source: "stellarx",
      price: "1.00",
      volume_24h: "1000000.00",
    };

    it("should validate a valid price record", async () => {
      const context: ValidationContext = {
        dataType: "priceRecord",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(validPriceRecord, "priceRecord", context);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject negative price", async () => {
      const invalidRecord = { ...validPriceRecord, price: "-1.00" };
      
      const context: ValidationContext = {
        dataType: "priceRecord",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidRecord, "priceRecord", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "price")).toBe(true);
    });

    it("should reject zero price", async () => {
      const invalidRecord = { ...validPriceRecord, price: "0" };
      
      const context: ValidationContext = {
        dataType: "priceRecord",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidRecord, "priceRecord", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "price")).toBe(true);
    });

    it("should warn about extreme price", async () => {
      const extremePrice = { ...validPriceRecord, price: "10000000.00" };
      
      const context: ValidationContext = {
        dataType: "priceRecord",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(extremePrice, "priceRecord", context);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.code === "EXTREME_PRICE")).toBe(true);
    });

    it("should warn about stale price data", async () => {
      const oldPrice = {
        ...validPriceRecord,
        time: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
      };
      
      const context: ValidationContext = {
        dataType: "priceRecord",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(oldPrice, "priceRecord", context);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.code === "STALE_PRICE_DATA")).toBe(true);
    });
  });

  describe("Health Score Validation", () => {
    const validHealthScore = {
      time: new Date(),
      symbol: "USDC",
      overall_score: 85,
      liquidity_depth_score: 80,
      price_stability_score: 90,
      bridge_uptime_score: 85,
      reserve_backing_score: 88,
      volume_trend_score: 82,
    };

    it("should validate a valid health score", async () => {
      const context: ValidationContext = {
        dataType: "healthScore",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(validHealthScore, "healthScore", context);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject score above 100", async () => {
      const invalidScore = { ...validHealthScore, overall_score: 101 };
      
      const context: ValidationContext = {
        dataType: "healthScore",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidScore, "healthScore", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "overall_score")).toBe(true);
    });

    it("should reject negative score", async () => {
      const invalidScore = { ...validHealthScore, liquidity_depth_score: -5 };
      
      const context: ValidationContext = {
        dataType: "healthScore",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidScore, "healthScore", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "liquidity_depth_score")).toBe(true);
    });

    it("should warn about inconsistent overall score", async () => {
      const inconsistentScore = {
        ...validHealthScore,
        overall_score: 50, // Very different from component average
        liquidity_depth_score: 90,
        price_stability_score: 90,
        bridge_uptime_score: 90,
        reserve_backing_score: 90,
        volume_trend_score: 90,
      };
      
      const context: ValidationContext = {
        dataType: "healthScore",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(inconsistentScore, "healthScore", context);

      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.code === "SCORE_INCONSISTENCY")).toBe(true);
    });
  });

  describe("Liquidity Snapshot Validation", () => {
    const validLiquiditySnapshot = {
      time: new Date(),
      symbol: "USDC",
      dex: "stellarx",
      base_asset: "USDC",
      quote_asset: "XLM",
      tvl_usd: "1000000.00",
      volume_24h_usd: "500000.00",
      bid_depth: "100000.00",
      ask_depth: "100000.00",
      spread_pct: "0.1",
    };

    it("should validate a valid liquidity snapshot", async () => {
      const context: ValidationContext = {
        dataType: "liquiditySnapshot",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(validLiquiditySnapshot, "liquiditySnapshot", context);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid DEX name", async () => {
      const invalidSnapshot = { ...validLiquiditySnapshot, dex: "invalid_dex" };
      
      const context: ValidationContext = {
        dataType: "liquiditySnapshot",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidSnapshot, "liquiditySnapshot", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "dex")).toBe(true);
    });

    it("should reject negative TVL", async () => {
      const invalidSnapshot = { ...validLiquiditySnapshot, tvl_usd: "-1000" };
      
      const context: ValidationContext = {
        dataType: "liquiditySnapshot",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidSnapshot, "liquiditySnapshot", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "tvl_usd")).toBe(true);
    });
  });

  describe("Alert Rule Validation", () => {
    const validAlertRule = {
      owner_address: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      name: "Price Alert",
      asset_code: "USDC",
      conditions: { price_threshold: 1.05 },
      condition_op: "AND",
      priority: "medium",
      cooldown_seconds: 3600,
      is_active: true,
      webhook_url: "https://example.com/webhook",
    };

    it("should validate a valid alert rule", async () => {
      const context: ValidationContext = {
        dataType: "alertRule",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(validAlertRule, "alertRule", context);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid owner address", async () => {
      const invalidRule = { ...validAlertRule, owner_address: "invalid" };
      
      const context: ValidationContext = {
        dataType: "alertRule",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidRule, "alertRule", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "owner_address")).toBe(true);
    });

    it("should reject invalid webhook URL", async () => {
      const invalidRule = { ...validAlertRule, webhook_url: "not-a-url" };
      
      const context: ValidationContext = {
        dataType: "alertRule",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidRule, "alertRule", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "webhook_url")).toBe(true);
    });

    it("should reject invalid priority", async () => {
      const invalidRule = { ...validAlertRule, priority: "invalid" };
      
      const context: ValidationContext = {
        dataType: "alertRule",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(invalidRule, "alertRule", context);

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.field === "priority")).toBe(true);
    });
  });

  describe("Batch Validation", () => {
    const validAssets = [
      { symbol: "USDC", name: "USD Coin", asset_type: "credit_alphanum4", is_active: true, issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
      { symbol: "EURC", name: "Euro Coin", asset_type: "credit_alphanum4", is_active: true, issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
      { symbol: "XLM", name: "Stellar Lumens", asset_type: "native", is_active: true, issuer: null },
    ];

    it("should validate batch of items", async () => {
      const context: ValidationContext = {
        dataType: "asset",
        operation: "batch",
        isAdmin: false,
      };

      const result = await validationService.validateBatch(validAssets, "asset", context);

      expect(result.totalItems).toBe(3);
      expect(result.validItems).toBe(3);
      expect(result.invalidItems).toBe(0);
      expect(result.results.every(r => r.isValid)).toBe(true);
    });

    it("should handle batch with invalid items", async () => {
      const mixedAssets = [
        ...validAssets,
        { symbol: "", name: "Invalid", asset_type: "credit_alphanum4", is_active: true, issuer: "invalid" },
      ];

      const context: ValidationContext = {
        dataType: "asset",
        operation: "batch",
        isAdmin: false,
      };

      const result = await validationService.validateBatch(mixedAssets, "asset", context);

      expect(result.totalItems).toBe(4);
      expect(result.validItems).toBe(3);
      expect(result.invalidItems).toBe(1);
      expect(result.summary.dataQualityScore).toBeGreaterThan(0);
    });

    it("should provide batch summary with recommendations", async () => {
      const context: ValidationContext = {
        dataType: "asset",
        operation: "batch",
        isAdmin: false,
      };

      const result = await validationService.validateBatch(validAssets, "asset", context);

      expect(result.summary.processingTime).toBeGreaterThanOrEqual(0);
      expect(result.summary.averageValidationTime).toBeGreaterThanOrEqual(0);
      expect(result.summary.recommendations).toBeInstanceOf(Array);
    });
  });

  describe("Admin Bypass", () => {
    const validAsset = {
      symbol: "TEST",
      name: "Test Asset",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      asset_type: "credit_alphanum4",
      is_active: true,
    };

    it("should allow admin bypass when configured", async () => {
      const originalBypass = config.VALIDATION_ADMIN_BYPASS;
      (config as any).VALIDATION_ADMIN_BYPASS = true;

      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: true,
      };

      const result = await validationService.validate(validAsset, "asset", context);

      expect(result.isValid).toBe(true);
      expect(result.metadata.bypassUsed).toBe(true);
      expect(result.warnings.some(w => w.code === "ADMIN_BYPASS")).toBe(true);

      (config as any).VALIDATION_ADMIN_BYPASS = originalBypass;
    });

    it("should not allow bypass for non-admin", async () => {
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate(validAsset, "asset", context);

      expect(result.metadata.bypassUsed).toBe(false);
    });
  });

  describe("Validation Metrics", () => {
    it("should track validation metrics", async () => {
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      // Perform multiple validations
      await validationService.validate({
        symbol: "TEST1",
        name: "Test 1",
        issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        asset_type: "credit_alphanum4",
        is_active: true,
      }, "asset", context);

      await validationService.validate({
        symbol: "",
        name: "Invalid",
        issuer: "invalid",
        asset_type: "invalid",
        is_active: true,
      }, "asset", context);

      const metrics = validationService.getMetrics();

      expect(metrics.totalValidations).toBe(2);
      expect(metrics.validationErrors).toBeGreaterThan(0);
      expect(metrics.validationWarnings).toBeGreaterThanOrEqual(0);
    });

    it("should reset metrics", async () => {
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      await validationService.validate({
        symbol: "TEST",
        name: "Test",
        issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        asset_type: "credit_alphanum4",
        is_active: true,
      }, "asset", context);

      validationService.resetMetrics();

      const metrics = validationService.getMetrics();
      expect(metrics.totalValidations).toBe(0);
      expect(metrics.validationErrors).toBe(0);
    });
  });

  describe("Validation Result Metadata", () => {
    it("should include validation metadata in result", async () => {
      const context: ValidationContext = {
        dataType: "asset",
        operation: "create",
        isAdmin: false,
      };

      const result = await validationService.validate({
        symbol: "USDC",
        name: "USD Coin",
        issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        asset_type: "credit_alphanum4",
        is_active: true,
      }, "asset", context);

      expect(result.metadata.dataType).toBe("asset");
      expect(result.metadata.validationTime).toBeGreaterThanOrEqual(0);
      expect(result.metadata.rulesApplied).toContain("schema_validation");
      expect(result.metadata.normalizedFields).toContain("symbol");
      expect(result.metadata.duplicateCheck).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle validation system errors gracefully", async () => {
      // Create a service with broken schema
      const brokenService = new ValidationService();
      
      const context: ValidationContext = {
        dataType: "invalid_type" as any,
        operation: "create",
        isAdmin: false,
      };

      const result = await brokenService.validate({ any: "data" }, "invalid_type" as any, context);

      // Should return a result even for unknown data types
      expect(result).toBeDefined();
    });
  });
});
