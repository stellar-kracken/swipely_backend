import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped context propagated across internal service calls within a
 * single request's lifetime, so logs and outbound HTTP calls can be
 * correlated back to the originating request without threading IDs through
 * every function signature.
 */
export interface RequestContext {
  requestId: string;
  correlationId: string;
  traceId: string;
  spanId: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Builds the headers an outbound call (to another internal service, or to an
 * external API on this request's behalf) should carry so the downstream
 * service can correlate its own logs/traces back to this request.
 */
export function getPropagationHeaders(): Record<string, string> {
  const context = getRequestContext();
  if (!context) return {};

  return {
    "x-request-id": context.requestId,
    "x-correlation-id": context.correlationId,
    "x-trace-id": context.traceId,
    "x-parent-span-id": context.spanId,
  };
}
