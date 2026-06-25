# Request Context Propagation

## Overview
Every inbound request gets a request ID, correlation ID, trace ID, and span ID
so that traces and logs from internal services can be tied back to the
request that triggered them. This builds on the existing tracing/correlation
middleware in [`src/api/middleware/tracing.ts`](../src/api/middleware/tracing.ts)
and [`src/api/middleware/correlation.middleware.ts`](../src/api/middleware/correlation.middleware.ts).

## How context is captured
`registerTracing` (in `tracing.ts`) runs on every request's `onRequest` hook:

1. It resolves IDs from inbound headers if present, generating new ones otherwise:
   - `x-request-id`
   - `x-correlation-id` / `x-trace-id`
   - `x-parent-span-id`
   - `x-user-id` (or the authenticated user, once auth middleware has run)
2. It attaches the resulting `TraceContext` to `request.traceContext` for
   route handlers and other middleware that have direct access to the
   Fastify request.
3. It also enters the context into an `AsyncLocalStorage`
   (see [`src/utils/requestContext.ts`](../src/utils/requestContext.ts)) for
   the remainder of the request's lifecycle, so code several layers deep in a
   service call — which does not have the Fastify `request` object — can
   still read the current request's context.
4. Response headers `X-Request-ID`, `X-Correlation-ID`, `X-Trace-ID`, and
   `X-Span-ID` are set so the context round-trips back to the caller.

## Using context propagation in services
```ts
import { getRequestContext, getPropagationHeaders } from "../utils/requestContext.js";

// Structured logging with the current request's IDs
const ctx = getRequestContext();
logger.info({ requestId: ctx?.requestId, correlationId: ctx?.correlationId }, "Fetching reserve data");

// Outbound call to another internal service or external API —
// forward the headers so the downstream service can correlate its logs.
const response = await fetch(url, { headers: getPropagationHeaders() });
```

`getPropagationHeaders()` returns:
```
x-request-id
x-correlation-id
x-trace-id
x-parent-span-id
```

If there is no active request context (e.g. a background job not triggered by
an HTTP request), both helpers return safely (`undefined` / `{}`) rather than
throwing, so they're safe to call unconditionally from shared service code.

## Header support
| Header | Set by caller (optional) | Set in response | Notes |
|---|---|---|---|
| `X-Request-ID` | — | ✅ | Unique per request |
| `X-Correlation-ID` | ✅ | ✅ | Reused across a logical operation that spans multiple requests |
| `X-Trace-ID` | ✅ | ✅ | W3C/Jaeger/Datadog trace identifiers are also derived from this |
| `X-Parent-Span-ID` | ✅ | — | Set by an upstream caller to link spans |
| `X-User-ID` | ✅ | — | Falls back to the authenticated user when omitted |

## Structured logs
`TracedLogger` (in `tracing.ts`) attaches `requestId`, `correlationId`,
`traceId`, `spanId`, and `userId` to every structured log line it writes, so
logs from a single request can be correlated in your log aggregator by
filtering on any of those fields.
