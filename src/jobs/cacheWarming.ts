import { cachePrimerService, CachePriority } from "../services/cachePrimer.service.js";
import { logger } from "../utils/logger.js";

/**
 * Cache warming script to manually trigger priming from CLI.
 */
export async function runCacheWarming(priority?: CachePriority) {
  logger.info({ priority }, "Starting manual cache warming process...");
  
  try {
    await cachePrimerService.prime(priority);
    logger.info("Cache warming successfully completed");
  } catch (error) {
    logger.error({ error }, "Cache warming failed");
    throw error;
  }
}

// Automatically runs if executed as script directly
// @ts-expect-error - Required for direct execution script detection
if (import.meta.url === `file://${process.argv[1]}`) {
  const priority = process.argv[2] as CachePriority;
  runCacheWarming(priority).then(() => process.exit(0)).catch(() => process.exit(1));
}
