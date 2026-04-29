# Cache Priming Strategy

## Overview
To ensure low-latency performance from the first user request after a deployment or restart, the system implements a **Cache Priming** mechanism. This pre-populates the Redis cache with critical data that would otherwise require expensive computations or external API calls.

## Priming Priorities

### High Priority (Hourly)
These entries are critical for the dashboard and main landing pages.
- **Protocol Stats**: Global TVL, volume, and active bridge counts.
- **Bridge Comparisons**: Cross-chain stats for all registered bridges.
- **Major Prices**: Real-time prices for top assets (XLM, USDC, USDT, BTC, ETH).
- **Top Performers**: Health score and TVL rankings for top 10 assets/bridges.

### Low Priority (Daily)
These entries are less frequently accessed but still beneficial to have cached.
- **All Asset Rankings**: Detailed health and liquidity stats for all supported assets.
- **Long-tail Prices**: Prices for all remaining supported assets.

## Implementation Details

### Service
The `CachePrimerService` manages the execution of priming tasks. It handles:
- **Partial Fill**: Failure in one task does not stop the entire process.
- **Concurrency**: Tasks are executed sequentially or in small batches to avoid overloading external APIs (e.g. CoinGecko rate limits).
- **Metrics**: Every attempt, success, and failure is recorded in Prometheus.

### Execution Hooks
1. **Startup**: The system runs a `HIGH` priority priming job immediately after the server starts.
2. **Scheduled**:
   - **Hourly**: Refreshes high-priority entries.
   - **Daily (03:00 UTC)**: Performs a full priming of all entries.

## Monitoring
Monitor the following metrics in Prometheus/Grafana:
- `cache_priming_total`: Number of priming attempts.
- `cache_priming_success_total`: Successful completions.
- `cache_priming_failure_total`: Failures with error reasons.
- `cache_priming_duration_seconds`: Time taken for each task.

## Troubleshooting
If failure rates increase:
1. Check upstream API status (Circle, CoinGecko).
2. Verify Redis connectivity.
3. Check logs for specific task errors (e.g. `protocol_stats` failing).
