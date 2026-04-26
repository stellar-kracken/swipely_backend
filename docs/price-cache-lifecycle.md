# Price Cache Lifecycle Documentation

## Overview

The price cache warmup system ensures that the UI has low-latency access to fresh price values by proactively warming the cache on startup and on a scheduled basis. This document describes the complete lifecycle of price caching in the Bridge Watch system.

## Architecture

### Components

1. **PriceCacheWarmupService** (`src/jobs/priceCacheWarmup.job.ts`)
   - Manages the cache warmup process
   - Handles retry logic and error recovery
   - Tracks cache freshness and staleness
   - Emits metrics for monitoring

2. **PriceCacheWarmupWorker** (`src/workers/priceCacheWarmup.worker.ts`)
   - BullMQ job processor for scheduled warmup
   - Integrates with the job queue system

3. **PriceService** (`src/services/price.service.ts`)
   - Fetches aggregated prices from multiple sources
   - Handles VWAP calculations and deviation checks
   - Supports source fallback mechanisms

4. **CacheService** (`src/utils/cache.ts`)
   - Redis-backed caching layer
   - Manages TTL and cache invalidation
   - Tracks cache statistics (hits, misses, errors)

## Cache Lifecycle

### 1. Startup Warmup

When the application starts, the job system initializes and runs a startup price cache warmup:

```
Application Start
    ↓
initJobSystem() called
    ↓
runPriceCacheWarmup() executed
    ↓
For each supported asset (excluding native/XLM):
  - Check if cached price is fresh
  - If stale or missing, fetch fresh price
  - Store in Redis with TTL
    ↓
Emit warmup metrics
    ↓
Continue with scheduled job initialization
```

**Key Features:**
- Non-blocking: Failures don't prevent application startup
- Concurrent: Processes assets in batches of 5 for efficiency
- Resilient: Includes retry logic with exponential backoff

### 2. Scheduled Warmup

After startup, the cache is refreshed on a schedule:

**Schedule:** Every 5 minutes (configurable via cron expression)

**Process:**
1. BullMQ triggers the `price-cache-warmup` job
2. Worker calls `processPriceCacheWarmup()`
3. Service warms up all supported assets
4. Metrics are recorded and emitted

### 3. Cache Freshness Detection

The system tracks cache freshness using:

- **Timestamp**: When the price was cached
- **Stale Threshold**: Default 5 minutes (configurable)
- **Age Calculation**: `(current_time - cache_timestamp) / 1000`

**Freshness States:**
- **Fresh**: Age < stale threshold → Use cached value
- **Stale**: Age ≥ stale threshold → Trigger refresh
- **Missing**: Not in cache → Fetch and cache

### 4. Source Fallback

When fetching prices, the system uses multiple sources:

1. **Primary Sources**: SDEX (Stellar DEX) and AMM pools
2. **Fallback**: If primary sources fail, retry with exponential backoff
3. **Max Retries**: 3 attempts per asset (configurable)
4. **Retry Delay**: 1s, 2s, 4s (exponential backoff)

### 5. Cache TTL Management

**Default TTL:** 60 seconds (1 minute)

**Configuration:**
```typescript
export enum CacheTTL {
  PRICES = 60,  // 1 minute
  // ... other TTLs
}
```

**Customization:**
```typescript
const config = {
  ttl: 120,  // 2 minutes
  stalePriceThreshold: 300,  // 5 minutes
};
const service = getPriceCacheWarmupService(config);
```

## Metrics and Monitoring

### Emitted Metrics

The warmup service emits the following metrics to Prometheus:

1. **Cache Hits** (`cache_hits_total`)
   - Incremented for each successfully cached price
   - Indicates cache effectiveness

2. **Cache Evictions** (`cache_evictions_total`)
   - Incremented for each stale price detected
   - Indicates cache refresh frequency

3. **Warmup Duration**
   - Tracked in milliseconds
   - Helps identify performance issues

### Warmup Metrics Structure

```typescript
interface PriceCacheWarmupMetrics {
  totalAssets: number;           // Total assets attempted
  successfulWarmups: number;     // Successfully cached
  failedWarmups: number;         // Failed to cache
  stalePrices: number;           // Stale prices detected
  duration: number;              // Warmup duration in ms
  timestamp: Date;               // When warmup occurred
}
```

### Monitoring Endpoints

- **Metrics Endpoint**: `/api/v1/metrics`
  - Prometheus-compatible metrics
  - Includes cache statistics

- **Cache Stats**: Available via `CacheService.getStats()`
  ```typescript
  {
    hits: number,
    misses: number,
    errors: number,
    bypassed: number,
    invalidations: number
  }
  ```

## Configuration

### Environment Variables

```bash
# Price cache warmup configuration
PRICE_CACHE_WARMUP_ENABLED=true
PRICE_CACHE_WARMUP_TTL=60
PRICE_CACHE_WARMUP_STALE_THRESHOLD=300
PRICE_CACHE_WARMUP_MAX_RETRIES=3
PRICE_CACHE_WARMUP_RETRY_DELAY_MS=1000
PRICE_CACHE_WARMUP_SOURCE_FAILOVER=true
```

### Programmatic Configuration

```typescript
import { getPriceCacheWarmupService } from './jobs/priceCacheWarmup.job';

const service = getPriceCacheWarmupService({
  enabled: true,
  ttl: 120,
  stalePriceThreshold: 300,
  maxRetries: 3,
  retryDelayMs: 1000,
  sourceFailoverEnabled: true,
});

const metrics = await service.warmupCache();
```

## Failure Handling

### Startup Failures

If startup warmup fails:
- Error is logged but doesn't block application startup
- Scheduled warmup will attempt to populate cache later
- UI may experience initial latency until cache is populated

### Scheduled Warmup Failures

If scheduled warmup fails:
- Error is logged and tracked in metrics
- Next scheduled warmup will retry
- Existing cached prices remain available (even if stale)

### Per-Asset Failures

If a single asset fails to warm up:
- Failure is logged with asset code
- Other assets continue warming
- Retry logic attempts up to 3 times
- Failed assets are tracked in metrics

### Graceful Degradation

The system implements graceful degradation:
- Cache misses fall back to on-demand fetching
- Redis failures don't prevent price fetching
- Stale prices are served if fresh prices unavailable
- Metrics track all failure modes

## Performance Considerations

### Concurrency

- **Batch Size**: 5 assets processed concurrently
- **Rationale**: Balances throughput with resource usage
- **Configurable**: Can be adjusted based on system capacity

### Timing

- **Startup Warmup**: ~2-5 seconds (depends on network)
- **Scheduled Warmup**: ~1-3 seconds (every 5 minutes)
- **Cache Hit Latency**: <1ms (Redis lookup)
- **Cache Miss Latency**: 100-500ms (network fetch)

### Resource Usage

- **Memory**: ~1KB per cached price
- **Redis Connections**: Shared with other services
- **Network**: ~50-100 requests per warmup cycle
- **CPU**: Minimal (mostly I/O bound)

## Troubleshooting

### Cache Not Warming

**Symptoms:** Prices always stale, high cache misses

**Diagnosis:**
1. Check if warmup is enabled: `PRICE_CACHE_WARMUP_ENABLED=true`
2. Verify Redis connectivity: `redis-cli ping`
3. Check logs for warmup errors
4. Verify network connectivity to price sources

**Solutions:**
- Restart application to trigger startup warmup
- Manually trigger warmup: `npm run warmup:prices`
- Check Redis memory: `redis-cli info memory`
- Verify price source availability

### High Stale Price Rate

**Symptoms:** Metrics show high `cache_evictions_total`

**Diagnosis:**
1. Check warmup frequency vs. TTL
2. Verify price source latency
3. Check for network issues

**Solutions:**
- Increase warmup frequency (reduce cron interval)
- Increase cache TTL
- Investigate price source performance
- Check network connectivity

### Warmup Timeouts

**Symptoms:** Warmup job hangs or times out

**Diagnosis:**
1. Check price source response times
2. Verify network connectivity
3. Check system resources (CPU, memory)

**Solutions:**
- Increase job timeout
- Reduce batch size for concurrent requests
- Investigate price source issues
- Scale system resources

## Best Practices

1. **Monitor Cache Metrics**
   - Track hit/miss ratio
   - Alert on high miss rates
   - Monitor warmup duration

2. **Tune Configuration**
   - Adjust TTL based on price volatility
   - Set stale threshold based on business requirements
   - Configure retry logic for reliability

3. **Handle Failures Gracefully**
   - Implement fallback mechanisms
   - Serve stale prices when necessary
   - Log all failures for debugging

4. **Optimize Performance**
   - Use appropriate batch sizes
   - Monitor Redis performance
   - Track warmup duration trends

5. **Test Thoroughly**
   - Test startup warmup
   - Test scheduled warmup
   - Test failure scenarios
   - Test cache invalidation

## Future Enhancements

1. **Adaptive Warmup**
   - Adjust frequency based on price volatility
   - Prioritize frequently accessed assets
   - Dynamic batch sizing

2. **Advanced Metrics**
   - Per-asset cache statistics
   - Price deviation tracking
   - Source reliability metrics

3. **Cache Invalidation**
   - Event-driven invalidation
   - Selective asset refresh
   - Bulk invalidation strategies

4. **Performance Optimization**
   - Parallel source fetching
   - Incremental cache updates
   - Compression for large datasets

## Related Documentation

- [Price Service](./API.md#price-endpoints)
- [Cache Strategy](./caching-strategy.md)
- [Metrics Collection](./metrics-collection.md)
- [Alert System](./alerts.swagger.yaml)
