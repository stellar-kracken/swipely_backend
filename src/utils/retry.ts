import { logger } from "./logger.js";
import { retryPolicyService, type RetryOperationOverride } from "../services/retryPolicy.service.js";

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
    delayMs: number = 1000,
    override?: Partial<RetryOperationOverride>
): Promise<T> {
    let lastError: Error | undefined;
    const operation = override?.operation ?? "generic";
    const policyOverride: Partial<RetryOperationOverride> = {
        ...override,
        maxRetries: retries,
        baseDelayMs: delayMs,
    };

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const failureClass = retryPolicyService.classifyFailure(lastError);
            const retryable = retryPolicyService.isRetryable(lastError);

            if (attempt <= retries && retryable) {
                const nextDelayMs = retryPolicyService.getDelayMs(attempt, policyOverride);
                retryPolicyService.recordRetryMetric(operation, "scheduled", attempt, failureClass);
                logger.warn(
                    { attempt, maxRetries: retries, delayMs: nextDelayMs, failureClass, error: lastError.message },
                    "Operation failed, retrying..."
                );
                await new Promise((resolve) => setTimeout(resolve, nextDelayMs));
            }
        }
    }

    retryPolicyService.recordRetryMetric(operation, "exhausted", retries + 1, retryPolicyService.classifyFailure(lastError));
    throw new Error(`Exhausted all ${retries} retries. Last error: ${lastError?.message}`);
}
