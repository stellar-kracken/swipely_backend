import { logger } from "./logger.js";

/**
 * Execute a promise-returning function with retry logic and exponential backoff.
 * 
 * @param {() => Promise<T>} fn - The async function to execute
 * @param {number} retries - Maximum number of retries
 * @param {number} delayMs - Base delay in milliseconds (starts at this value, doubles each retry)
 * @returns {Promise<T>} Result of the function if successful
 * @throws {Error} The final error encountered after all retries are exhausted
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    retries: number = 3,
    delayMs: number = 1000
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt <= retries) {
                logger.warn(
                    { attempt, maxRetries: retries, delayMs, error: lastError.message },
                    "Operation failed, retrying..."
                );
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                delayMs *= 2; // Exponential backoff
            }
        }
    }

    throw new Error(`Exhausted all ${retries} retries. Last error: ${lastError?.message}`);
}
