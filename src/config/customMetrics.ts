import { CustomMetric } from "../services/analytics.service.js";

/**
 * Custom metric definitions for advanced analytics
 * These can be extended by users to create custom aggregations
 */
export const CUSTOM_METRICS: Record<string, CustomMetric> = {
  // Bridge reliability score based on verification success rate
  bridgeReliability: {
    id: "bridge-reliability",
    name: "Bridge Reliability Score",
    description: "Calculates reliability score based on verification success rate and uptime",
    query: `
      SELECT 
        bo.bridge_id,
        bo.provider_name,
        COUNT(vr.id) as total_verifications,
        SUM(CASE WHEN vr.is_valid THEN 1 ELSE 0 END) as successful_verifications,
        (SUM(CASE WHEN vr.is_valid THEN 1 ELSE 0 END)::float / NULLIF(COUNT(vr.id), 0) * 100) as success_rate,
        CASE 
          WHEN (SUM(CASE WHEN vr.is_valid THEN 1 ELSE 0 END)::float / NULLIF(COUNT(vr.id), 0) * 100) >= 99 THEN 'excellent'
          WHEN (SUM(CASE WHEN vr.is_valid THEN 1 ELSE 0 END)::float / NULLIF(COUNT(vr.id), 0) * 100) >= 95 THEN 'good'
          WHEN (SUM(CASE WHEN vr.is_valid THEN 1 ELSE 0 END)::float / NULLIF(COUNT(vr.id), 0) * 100) >= 90 THEN 'fair'
          ELSE 'poor'
        END as reliability_rating
      FROM bridge_operators bo
      LEFT JOIN verification_results vr ON vr.bridge_id = bo.bridge_id
        AND vr.verified_at >= NOW() - INTERVAL '7 days'
      WHERE bo.is_active = true
      GROUP BY bo.bridge_id, bo.provider_name
      ORDER BY success_rate DESC
    `,
    parameters: {},
    cacheKey: "bridge-reliability",
    cacheTTL: 600, // 10 minutes
  },

  // Asset liquidity concentration (Herfindahl index)
  liquidityConcentration: {
    id: "liquidity-concentration",
    name: "Liquidity Concentration Index",
    description: "Measures liquidity concentration across DEXes using Herfindahl index",
    query: `
      WITH dex_shares AS (
        SELECT 
          symbol,
          dex,
          SUM(tvl_usd) as dex_tvl,
          SUM(SUM(tvl_usd)) OVER (PARTITION BY symbol) as total_tvl
        FROM liquidity_snapshots
        WHERE time >= NOW() - INTERVAL '1 hour'
        GROUP BY symbol, dex
      ),
      market_shares AS (
        SELECT 
          symbol,
          dex,
          dex_tvl,
          total_tvl,
          (dex_tvl / NULLIF(total_tvl, 0)) as market_share
        FROM dex_shares
      )
      SELECT 
        symbol,
        total_tvl,
        COUNT(DISTINCT dex) as dex_count,
        SUM(POWER(market_share, 2)) as herfindahl_index,
        CASE 
          WHEN SUM(POWER(market_share, 2)) < 0.15 THEN 'highly_distributed'
          WHEN SUM(POWER(market_share, 2)) < 0.25 THEN 'moderately_distributed'
          WHEN SUM(POWER(market_share, 2)) < 0.50 THEN 'moderately_concentrated'
          ELSE 'highly_concentrated'
        END as concentration_level
      FROM market_shares
      GROUP BY symbol, total_tvl
      ORDER BY herfindahl_index ASC
    `,
    parameters: {},
    cacheKey: "liquidity-concentration",
    cacheTTL: 600,
  },

  // Alert effectiveness metrics
  alertEffectiveness: {
    id: "alert-effectiveness",
    name: "Alert System Effectiveness",
    description: "Analyzes alert delivery success and response times",
    query: `
      SELECT 
        alert_type,
        priority,
        COUNT(*) as total_alerts,
        SUM(CASE WHEN webhook_delivered THEN 1 ELSE 0 END) as delivered_alerts,
        (SUM(CASE WHEN webhook_delivered THEN 1 ELSE 0 END)::float / COUNT(*) * 100) as delivery_rate,
        AVG(webhook_attempts) as avg_attempts,
        MAX(webhook_attempts) as max_attempts,
        AVG(EXTRACT(EPOCH FROM (webhook_delivered_at - time))) as avg_delivery_time_seconds
      FROM alert_events
      WHERE time >= NOW() - INTERVAL '7 days'
      GROUP BY alert_type, priority
      ORDER BY priority DESC, total_alerts DESC
    `,
    parameters: {},
    cacheKey: "alert-effectiveness",
    cacheTTL: 900, // 15 minutes
  },

  // Cross-chain flow analysis
  crossChainFlow: {
    id: "cross-chain-flow",
    name: "Cross-Chain Flow Analysis",
    description: "Analyzes net flow direction and magnitude across bridges",
    query: `
      SELECT 
        b.name as bridge_name,
        b.source_chain,
        bvs.symbol,
        SUM(bvs.inflow_amount) as total_inflow,
        SUM(bvs.outflow_amount) as total_outflow,
        SUM(bvs.net_flow) as net_flow,
        CASE 
          WHEN SUM(bvs.net_flow) > 0 THEN 'net_inflow'
          WHEN SUM(bvs.net_flow) < 0 THEN 'net_outflow'
          ELSE 'balanced'
        END as flow_direction,
        ABS(SUM(bvs.net_flow)) as flow_magnitude,
        SUM(bvs.tx_count) as transaction_count
      FROM bridge_volume_stats bvs
      JOIN bridges b ON b.name = bvs.bridge_name
      WHERE bvs.stat_date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY b.name, b.source_chain, bvs.symbol
      ORDER BY flow_magnitude DESC
    `,
    parameters: {},
    cacheKey: "cross-chain-flow",
    cacheTTL: 600,
  },

  // Price volatility ranking
  priceVolatility: {
    id: "price-volatility",
    name: "Price Volatility Ranking",
    description: "Ranks assets by price volatility over different time periods",
    query: `
      WITH hourly_stats AS (
        SELECT 
          symbol,
          time_bucket('1 hour', time) as hour,
          AVG(price) as avg_price,
          STDDEV(price) as price_stddev,
          (MAX(price) - MIN(price)) / NULLIF(AVG(price), 0) * 100 as price_range_pct
        FROM prices
        WHERE time >= NOW() - INTERVAL '24 hours'
        GROUP BY symbol, hour
      )
      SELECT 
        symbol,
        AVG(price_stddev) as avg_hourly_stddev,
        MAX(price_range_pct) as max_hourly_range_pct,
        AVG(price_range_pct) as avg_hourly_range_pct,
        CASE 
          WHEN AVG(price_range_pct) < 0.1 THEN 'very_stable'
          WHEN AVG(price_range_pct) < 0.5 THEN 'stable'
          WHEN AVG(price_range_pct) < 1.0 THEN 'moderate'
          WHEN AVG(price_range_pct) < 2.0 THEN 'volatile'
          ELSE 'highly_volatile'
        END as volatility_rating
      FROM hourly_stats
      GROUP BY symbol
      ORDER BY avg_hourly_range_pct DESC
    `,
    parameters: {},
    cacheKey: "price-volatility",
    cacheTTL: 300,
  },

  // Bridge market dominance trends
  bridgeMarketDominance: {
    id: "bridge-market-dominance",
    name: "Bridge Market Dominance Trends",
    description: "Tracks market share changes for bridges over time",
    query: `
      WITH daily_volumes AS (
        SELECT 
          stat_date,
          bridge_name,
          SUM(inflow_amount + outflow_amount) as daily_volume,
          SUM(SUM(inflow_amount + outflow_amount)) OVER (PARTITION BY stat_date) as total_daily_volume
        FROM bridge_volume_stats
        WHERE stat_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY stat_date, bridge_name
      )
      SELECT 
        bridge_name,
        AVG(daily_volume / NULLIF(total_daily_volume, 0) * 100) as avg_market_share,
        STDDEV(daily_volume / NULLIF(total_daily_volume, 0) * 100) as market_share_volatility,
        MIN(daily_volume / NULLIF(total_daily_volume, 0) * 100) as min_market_share,
        MAX(daily_volume / NULLIF(total_daily_volume, 0) * 100) as max_market_share,
        CASE 
          WHEN STDDEV(daily_volume / NULLIF(total_daily_volume, 0) * 100) < 2 THEN 'stable'
          WHEN STDDEV(daily_volume / NULLIF(total_daily_volume, 0) * 100) < 5 THEN 'moderate'
          ELSE 'volatile'
        END as dominance_stability
      FROM daily_volumes
      GROUP BY bridge_name
      ORDER BY avg_market_share DESC
    `,
    parameters: {},
    cacheKey: "bridge-market-dominance",
    cacheTTL: 900,
  },
};

/**
 * Get a custom metric by ID
 */
export function getCustomMetric(id: string): CustomMetric | undefined {
  return CUSTOM_METRICS[id];
}

/**
 * Get all custom metric definitions
 */
export function getAllCustomMetrics(): CustomMetric[] {
  return Object.values(CUSTOM_METRICS);
}
