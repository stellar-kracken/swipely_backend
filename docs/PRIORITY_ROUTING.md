# Priority Routing Service

This service provides prioritized queues and rate limits for job ingestion and processing.

- Implemented in: backend/src/workers/queue.ts
- Queues created per-priority: bridge-watch-jobs-critical, -high, -medium, -low
- Enqueue with JobQueue.getInstance().addJob(name, data, { priority: 'critical' })
- Rate limits per-priority can be configured via env:
  - QUEUE_RATE_MAX_CRITICAL, QUEUE_RATE_DURATION_MS_CRITICAL
  - QUEUE_RATE_MAX_HIGH, QUEUE_RATE_DURATION_MS_HIGH
  - QUEUE_RATE_MAX_MEDIUM, QUEUE_RATE_DURATION_MS_MEDIUM
  - QUEUE_RATE_MAX_LOW, QUEUE_RATE_DURATION_MS_LOW

Fallback strategy:
- If a high-priority queue is overloaded, jobs can be re-routed to the next-highest queue by producer logic.
- Consumers should prefer critical/high queues first. The provided JobQueue creates separate BullMQ queues; consumers can inspect getJobCounts() to determine load and throttle low-priority work.

Admin controls:
- Use JobQueue.getInstance().getJobCounts() to monitor queue lengths per-priority.
- Stop/adjust rate limits via environment/ops and restart the workers.

Consumer changes:
- Update job producers to pass a priority option when calling addJob. Workers will process jobs from priority queues.
