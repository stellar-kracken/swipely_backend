# Analytics Aggregation Service

The Analytics Aggregation Service provides comprehensive statistics, metrics, and insights across all monitored bridge and asset data for dashboard displays and reporting.

## Features

### Core Capabilities

1. **Protocol-wide Statistics**
   - Total Value Locked (TVL) across all bridges
   - 24h, 7d, and 30d volume aggregations
   - Active bridge and asset counts
   - Transaction counts and averages
   - Average health scores

2. **Bridge Comparison Metrics**
   - TVL rankings
   - Volume comparisons (24h, 7d, 30d)
   - Transaction counts and average sizes
   - Market share calculations
   - Status monitoring
   - 24h trend analysis

3. **Asset Rankings**
   - Health score rankings
   - Liquidity depth measurements
   - Volume rankings
   - Price stability scores
   - Bridge count per asset
   - Trend indicators

4. **Volume Aggregations**
   - Time-series aggregations (hourly, daily, weekly, monthly)
   - Inflow/outflow tracking
   - Net flow calculations
   - Peak volume identification
   - Transaction count summaries

5. **Trend Calculations**
   - Percentage change calculations
   - Period-over-period comparisons
   - Trend direction indicators (up/down/stable)
   - Support for multiple metrics (health_score, tvl, volume)

6. **Top Performers**
   - Top assets by health, volume, or TVL
   - Top bridges by volume or TVL
   - Configurable result limits

7. **Custom Metrics**
   - Bridge reliability scoring
   - Liquidity concentration analysis (Herfindahl index)
   - Alert effectiveness metrics
   - Cross-chain flow analysis
   - Price volatility rankings
   - Bridge market dominance trends

8. **Historical Comparisons**
   - Time-series data for trending
   - Configurable lookback periods
   - Support for multiple metrics

## Architecture

### TimescaleDB Continuous Aggregates

The service leverages TimescaleDB's continuous aggregates for efficient pre-computation:

- **prices_hourly / prices_daily**: Price statistics with OHLC data
- **health_scores_hourly / health_scores_daily**: Health score aggregations
- **liquidity_hourly / liquidity_daily**: Liquidity metrics across DEXes
- **alert_events_hourly**: Alert frequency and delivery metrics
- **verification_results_hourly**: Verification success rates

These materialized views are automatically maintained by TimescaleDB policies.

### Caching Layer

All analytics queries are cached in Redis with configurable TTLs:

- Default TTL: 5 minutes (300 seconds)
- Custom metric TTLs: Configurable per metric
- Cache keys follow pattern: `analytics:{category}:{subcategory}`

### Scheduled Aggregation Jobs

Background workers pre-compute and cache analytics at regular intervals:

- Protocol stats: Every 2 minutes
- Bridge comparisons: Every 3 minutes
- Asset rankings: Every 3 minutes
- Volume aggregations: Every 5 minutes
- Top performers: Every 5 minutes

## API Endpoints

### GET /api/v1/analytics/protocol

Get protocol-wide statistics.

**Response:**

```json
{
  "success": true,
  "data": {
    "totalValueLocked": "10000000.00",
    "totalVolume24h": "5000000.00",
    "totalVolume7d": "30000000.00",
    "totalVolume30d": "100000000.00",
    "activeBridges": 5,
    "activeAssets": 10,
    "totalTransactions24h": 1500,
    "averageHealthScore": 92,
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### GET /api/v1/analytics/bridges/comparison

Get bridge comparison metrics.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "bridgeName": "Circle USDC",
      "tvl": "5000000.00",
      "volume24h": "2000000.00",
      "volume7d": "12000000.00",
      "volume30d": "45000000.00",
      "transactionCount": 750,
      "averageTransactionSize": "2666.67",
      "status": "healthy",
      "marketShare": 50.0,
      "trend": "up",
      "changePercent24h": 5.2
    }
  ]
}
```

### GET /api/v1/analytics/assets/rankings

Get asset rankings by health score.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "symbol": "USDC",
      "rank": 1,
      "tvl": "8000000.00",
      "volume24h": "3000000.00",
      "healthScore": 95,
      "priceStability": 98,
      "liquidityDepth": "8000000.00",
      "bridgeCount": 3,
      "trend": "stable",
      "changePercent24h": 0.5
    }
  ]
}
```

### GET /api/v1/analytics/volume

Get volume aggregations.

**Query Parameters:**

- `period`: hourly | daily | weekly | monthly (default: daily)
- `symbol`: Filter by asset symbol (optional)
- `bridgeName`: Filter by bridge name (optional)

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "period": "2024-01-15T00:00:00Z",
      "totalVolume": "5000000.00",
      "inflowVolume": "3000000.00",
      "outflowVolume": "2000000.00",
      "netFlow": "1000000.00",
      "transactionCount": 1500,
      "averageTransactionSize": "3333.33",
      "peakVolume": "500000.00",
      "peakTimestamp": null
    }
  ]
}
```

### GET /api/v1/analytics/trends/:metric

Calculate trend for a specific metric.

**Path Parameters:**

- `metric`: health_score | tvl | volume

**Query Parameters:**

- `symbol`: Asset symbol (required for health_score)
- `bridgeName`: Bridge name (optional)

**Response:**

```json
{
  "success": true,
  "data": {
    "metric": "health_score",
    "current": 95,
    "previous": 92,
    "change": 3,
    "changePercent": 3.26,
    "trend": "up"
  }
}
```

### GET /api/v1/analytics/top-performers

Get top performing assets or bridges.

**Query Parameters:**

- `type`: assets | bridges (default: assets)
- `metric`: volume | tvl | health (default: health)
- `limit`: Number of results (default: 10)

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "symbol": "USDC",
      "rank": 1,
      "healthScore": 95,
      "volume24h": "3000000.00"
    }
  ]
}
```

### GET /api/v1/analytics/historical/:metric

Get historical comparison data.

**Path Parameters:**

- `metric`: health_score | volume | liquidity

**Query Parameters:**

- `symbol`: Asset symbol (required for health_score and liquidity)
- `days`: Lookback period in days (default: 30)

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "date": "2024-01-15",
      "value": 95
    }
  ]
}
```

### GET /api/v1/analytics/summary

Get comprehensive analytics summary.

**Response:**

```json
{
  "success": true,
  "data": {
    "protocol": {
      /* protocol stats */
    },
    "topAssets": [
      /* top 5 assets */
    ],
    "topBridges": [
      /* top 5 bridges */
    ]
  }
}
```

### GET /api/v1/analytics/custom-metrics

List all available custom metrics.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "bridge-reliability",
      "name": "Bridge Reliability Score",
      "description": "Calculates reliability score based on verification success rate and uptime",
      "cacheTTL": 600
    }
  ]
}
```

### GET /api/v1/analytics/custom-metrics/:metricId

Execute a custom metric query.

**Path Parameters:**

- `metricId`: Custom metric identifier

**Response:**

```json
{
  "success": true,
  "data": {
    "metric": {
      "id": "bridge-reliability",
      "name": "Bridge Reliability Score",
      "description": "..."
    },
    "result": [
      /* query results */
    ]
  }
}
```

### POST /api/v1/analytics/cache/invalidate

Invalidate analytics cache.

**Body:**

```json
{
  "pattern": "protocol" // optional, invalidates specific pattern
}
```

**Response:**

```json
{
  "success": true,
  "message": "Cache invalidated for pattern: protocol"
}
```

## Custom Metrics

Custom metrics are defined in `backend/src/config/customMetrics.ts`. Each metric includes:

- **id**: Unique identifier
- **name**: Display name
- **description**: Metric description
- **query**: SQL query to execute
- **parameters**: Query parameters
- **cacheKey**: Redis cache key
- **cacheTTL**: Cache time-to-live in seconds

### Available Custom Metrics

1. **bridge-reliability**: Bridge reliability scoring based on verification success rates
2. **liquidity-concentration**: Liquidity distribution analysis using Herfindahl index
3. **alert-effectiveness**: Alert delivery success and response time metrics
4. **cross-chain-flow**: Net flow analysis across bridges
5. **price-volatility**: Asset volatility rankings
6. **bridge-market-dominance**: Market share trend analysis

### Adding Custom Metrics

To add a new custom metric:

1. Define the metric in `customMetrics.ts`:

```typescript
export const CUSTOM_METRICS: Record<string, CustomMetric> = {
  myMetric: {
    id: "my-metric",
    name: "My Custom Metric",
    description: "Description of what this metric measures",
    query: `
      SELECT 
        column1,
        column2,
        AGG_FUNCTION(column3) as result
      FROM table_name
      WHERE conditions
      GROUP BY column1, column2
    `,
    parameters: {},
    cacheKey: "my-metric",
    cacheTTL: 600,
  },
};
```

2. Access via API: `GET /api/v1/analytics/custom-metrics/my-metric`

## Performance Considerations

### Query Optimization

1. **Use Continuous Aggregates**: Query pre-aggregated views instead of raw hypertables
2. **Leverage Indexes**: All continuous aggregates have indexes on (symbol, bucket)
3. **Cache Aggressively**: All queries are cached with appropriate TTLs
4. **Limit Result Sets**: Use LIMIT clauses and pagination where appropriate

### Caching Strategy

- **Hot Data** (2-5 min TTL): Protocol stats, top performers
- **Warm Data** (5-10 min TTL): Bridge comparisons, asset rankings
- **Cold Data** (10-15 min TTL): Historical comparisons, custom metrics

### Background Jobs

Scheduled jobs pre-compute expensive queries:

- Reduces API response times
- Ensures fresh data availability
- Distributes computational load

## Monitoring

### Key Metrics to Monitor

1. **Cache Hit Rate**: Should be >80% for optimal performance
2. **Query Execution Time**: Monitor slow queries
3. **Job Success Rate**: Ensure aggregation jobs complete successfully
4. **Redis Memory Usage**: Monitor cache size growth

### Logging

All analytics operations are logged with context:

```typescript
logger.info({ metric, symbol, bridgeName }, "Computing analytics");
logger.error({ error, metricId }, "Failed to execute custom metric");
```

## Testing

Run analytics service tests:

```bash
npm test -- analytics.service.test.ts
```

Tests cover:

- Cache hit/miss scenarios
- Aggregation calculations
- Trend analysis
- Custom metric execution
- Error handling

## Future Enhancements

1. **Real-time Updates**: WebSocket support for live analytics
2. **Predictive Analytics**: ML-based trend forecasting
3. **Anomaly Detection**: Automated detection of unusual patterns
4. **Export Capabilities**: CSV/JSON export for reports
5. **Custom Dashboards**: User-defined metric combinations
6. **Alert Integration**: Trigger alerts based on analytics thresholds
