/**
 * The request scope: everything that identifies one HTTP request while React
 * Router handles it (the process runtime, request id, cancellation and trace),
 * and the telemetry React Router's own server work produces within it.
 *
 * - `createAppLoadContext` starts a request's router context (`server.ts`);
 * - `requestMiddleware` opens the request's server span (`root.tsx`);
 * - `instrumentations`, `traceRender`, `logStreamError` and `logServerError`
 *   trace loaders, actions, the render and caught errors (`entry.server.tsx`);
 * - `requestScope` is how the bridge (`effect.server.ts`) enters the scope.
 *
 * Every span, metric and log of a request nests under its server span.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { Clock, Context, Data, Duration, Effect, Exit, Metric, Option, Tracer } from 'effect';
import type { MiddlewareFunction, ServerInstrumentation } from 'react-router';
import { createContext, isRouteErrorResponse, RouterContextProvider } from 'react-router';

import type { AppRuntime } from '../../server/runtime.ts';

type ReadonlyContext = Pick<RouterContextProvider, 'get'>;
type ReadonlyRequest = { readonly method: string; readonly url: string; readonly headers: Pick<Headers, 'get'> };

// ---------------------------------------------------------------------------
// The request scope
// ---------------------------------------------------------------------------

/** The TCP peer, as seen by `server.ts` (before any proxy headers). */
export interface ClientInfo {
  readonly address: string;
  readonly port: number;
}

/** What the root middleware learns about a matched request. */
interface MatchedRequest {
  readonly id: string;
  readonly signal: AbortSignal;
  /** The request's server span: the parent of every span created while handling it. */
  readonly span: Tracer.AnySpan | undefined;
}

const runtimeKey = createContext<AppRuntime>();
/** Absent when a router context is built without a socket (tests). */
const clientKey = createContext<ClientInfo | undefined>(undefined);
const matchedKey = createContext<MatchedRequest>();

/**
 * The span of the loader/action currently executing, if it is instrumented.
 * Loaders of one request run concurrently and share a router context, so the
 * context can't say which one is calling `run()`; async-local storage can
 * (this is how OpenTelemetry's own Node context manager works).
 */
const handlerSpanStorage = new AsyncLocalStorage<Tracer.AnySpan>();

/** Builds the per-request router context. Called by the process entry (`server.ts`). */
export const createAppLoadContext = (runtime: AppRuntime, client?: ClientInfo): RouterContextProvider => {
  const context = new RouterContextProvider();
  context.set(runtimeKey, runtime);
  context.set(clientKey, client);
  return context;
};

const tryGet = <T>(get: () => T): T | undefined => {
  try {
    return get();
  } catch {
    return undefined;
  }
};

const runtimeOf = (context: ReadonlyContext | undefined) => tryGet(() => context?.get(runtimeKey));
const clientOf = (context: ReadonlyContext | undefined) => tryGet(() => context?.get(clientKey));

/** The runtime and matched request of a router context, if both are set (they are unless middleware never ran). */
const findMatched = (context: ReadonlyContext | undefined) => {
  const runtime = runtimeOf(context);
  const request = tryGet(() => context?.get(matchedKey));
  return runtime === undefined || request === undefined ? undefined : { runtime, request };
};

export interface RequestScope {
  readonly runtime: AppRuntime;
  readonly id: string;
  /** Aborts when the client goes away. */
  readonly signal: AbortSignal;
  /** The span new work should nest under: the calling loader/action's, else the request's. */
  readonly parentSpan: Tracer.AnySpan | undefined;
}

/**
 * The scope of the request a router context belongs to. Throws if the root
 * middleware never ran for it: that is a wiring bug, surfacing as a 500.
 */
export const requestScope = (context: ReadonlyContext): RequestScope => {
  const found = findMatched(context);

  if (found === undefined) {
    throw new Error('No request scope: the root middleware has not run for this router context');
  }

  const { runtime, request: matched } = found;
  return {
    runtime,
    id: matched.id,
    signal: matched.signal,
    parentSpan: handlerSpanStorage.getStore() ?? matched.span,
  };
};

/** Runs a telemetry effect for a request, detached and never throwing into React Router. */
const observe = (context: ReadonlyContext | undefined, effect: Effect.Effect<void>) => {
  const found = findMatched(context);

  if (found === undefined) {
    return;
  }

  const { span, id } = found.request;

  found.runtime.runFork(
    (span === undefined ? effect : effect.pipe(Effect.withParentSpan(span))).pipe(Effect.annotateLogs({ requestId: id })),
  );
};

// ---------------------------------------------------------------------------
// Server spans, shared by matched and unmatched requests
// ---------------------------------------------------------------------------

/** OpenTelemetry semantic-convention buckets for HTTP durations (seconds). */
const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

const httpDuration = Metric.histogram('http.server.request.duration', {
  description: 'Duration of HTTP requests handled by React Router, by method, route and status',
  boundaries: HTTP_DURATION_BUCKETS,
  attributes: { unit: 's' },
});

const httpActiveRequests = Metric.counter('http.server.active_requests', {
  description: 'HTTP requests currently being handled by React Router',
});

/** Milliseconds with 0.1 ms precision, for log attributes and `Server-Timing`. */
const roundMillis = (duration: Duration.Duration) => Math.round(Duration.toMillis(duration) * 10) / 10;

/** React Router patterns are relative (`pokemon/:name`); `http.route` is absolute (`/pokemon/:name`). */
const normalizeRoute = (pattern: string) => (pattern.startsWith('/') ? pattern : `/${pattern}`);

const REQUEST_ID_PATTERN = /^[\w.-]{1,128}$/;

/** A sane incoming `x-request-id` is reused; anything else gets a fresh id. */
const requestIdOf = (request: ReadonlyRequest) => {
  const incoming = request.headers.get('x-request-id');
  return incoming !== null && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
};

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const INVALID_TRACE_ID = /^0+$/;

/**
 * Parses an incoming W3C `traceparent` header (https://www.w3.org/TR/trace-context/)
 * into a span to continue, so a caller that is itself traced (a gateway,
 * another service, a load test) sees this service inside its own trace.
 * Malformed or all-zero ids are ignored and a new trace is started.
 */
const parseTraceparent = (header: string | null): Tracer.ExternalSpan | undefined => {
  const match = header === null ? null : TRACEPARENT.exec(header.trim().toLowerCase());

  if (match === null) {
    return undefined;
  }

  const [, traceId = '', spanId = '', flags = '00'] = match;

  if (INVALID_TRACE_ID.test(traceId) || INVALID_TRACE_ID.test(spanId)) {
    return undefined;
  }

  // oxlint-disable-next-line no-bitwise -- the "sampled" flag is bit 0 of trace-flags
  return Tracer.externalSpan({ traceId, spanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 });
};

/** `traceparent` for a span, e.g. to hand it back to the browser. */
const formatTraceparent = (span: Tracer.AnySpan) => `00-${span.traceId}-${span.spanId}-01`;

type RequestType = 'document' | 'data' | 'unmatched';

/** React Router single-fetch requests (client-side navigations) end in `.data`. */
const matchedRequestType = (url: URL): RequestType => (url.pathname.endsWith('.data') ? 'data' : 'document');

/** Attributes of `http.server.request.duration`, also set on the server span. */
const metricAttributesOf = (request: ReadonlyRequest, type: RequestType, route: string | undefined) => ({
  'http.request.method': request.method,
  ...(route === undefined ? {} : { 'http.route': route }),
  'react_router.request.type': type,
});

/** Every server span's attributes, matched or not. */
const serverSpanAttributes = (
  request: ReadonlyRequest,
  url: URL,
  id: string,
  client: ClientInfo | undefined,
  metricAttributes: Record<string, string>,
): Record<string, unknown> => ({
  ...metricAttributes,
  'url.path': url.pathname,
  'url.scheme': url.protocol.replace(/:$/, ''),
  'server.address': url.hostname,
  'user_agent.original': request.headers.get('user-agent') ?? undefined,
  'client.address': client?.address,
  'client.port': client?.port,
  'request.id': id,
});

/** Records a finished request: the duration metric and the access log (error for 5xx). */
const recordRequestEnd = (
  message: string,
  metricAttributes: Record<string, string>,
  status: number,
  elapsed: Duration.Duration,
) =>
  Effect.gen(function* () {
    yield* Metric.update(
      Metric.withAttributes(httpDuration, {
        ...metricAttributes,
        'http.response.status_code': String(status),
        ...(status >= 500 ? { 'error.type': String(status) } : {}),
      }),
      Duration.toSeconds(elapsed),
    );

    const log = status >= 500 ? Effect.logError(message) : Effect.logInfo(message);
    yield* log.pipe(Effect.annotateLogs({ status, durationMs: roundMillis(elapsed) }));
  });

// ---------------------------------------------------------------------------
// Matched requests: the root middleware opens the server span
// ---------------------------------------------------------------------------

/** 5xx: the server span must end as an error, but the response is still returned. */
class ServerErrorResponse extends Data.TaggedError('ServerErrorResponse')<{ readonly response: Response }> {}

const trySetHeader = (response: Response, name: string, value: string) => {
  try {
    response.headers.set(name, value);
  } catch {
    // Some responses (e.g. Response.redirect) have immutable headers.
  }
};

/**
 * Root server middleware. For every request that reaches React Router it:
 *
 * - assigns a request id (reusing a sane incoming `x-request-id`) and echoes it;
 * - opens a `SERVER` span named `METHOD /route/:pattern`, continuing the
 *   caller's trace if a `traceparent` header was sent; every loader, action,
 *   Effect program and render span of the request nests under it;
 * - records `http.server.request.duration` and `http.server.active_requests`;
 * - logs the request start (debug) and end (info, or error for 5xx), with the
 *   trace id attached;
 * - returns a `Server-Timing` header carrying the `traceparent`, so the trace
 *   of any page can be found from the browser's dev tools.
 *
 * The span is opened here rather than around the whole request (in
 * `instrumentations`) because an Effect span can't be renamed once the route
 * is known, and `METHOD /route` is the OpenTelemetry server span name.
 */
export const requestMiddleware: MiddlewareFunction<Response> = async ({ request, context, pattern }, next) => {
  const id = requestIdOf(request);
  const runtime = context.get(runtimeKey);
  const url = new URL(request.url);
  const route = normalizeRoute(pattern);
  const metricAttributes = metricAttributesOf(request, matchedRequestType(url), route);
  const active = Metric.withAttributes(httpActiveRequests, metricAttributes);

  const handle = Effect.gen(function* () {
    const span = yield* Effect.currentSpan;
    context.set(matchedKey, { id, signal: request.signal, span });

    yield* Metric.update(active, 1);
    yield* Effect.logDebug('request start');

    const [elapsed, response] = yield* Effect.timed(Effect.promise(() => next())).pipe(
      Effect.ensuring(Metric.update(active, -1)),
      Effect.tapCause((cause) => Effect.logError('request failed', cause)),
    );

    const status = response.status;
    yield* Effect.annotateCurrentSpan({ 'http.response.status_code': status });
    yield* recordRequestEnd('request end', metricAttributes, status, elapsed);

    trySetHeader(response, 'x-request-id', id);
    trySetHeader(response, 'server-timing', `traceparent;desc="${formatTraceparent(span)}", total;dur=${roundMillis(elapsed)}`);

    return status >= 500 ? yield* new ServerErrorResponse({ response }) : response;
  });

  return runtime.runPromise(
    handle.pipe(
      Effect.withSpan(`${request.method} ${route}`, {
        kind: 'server',
        parent: parseTraceparent(request.headers.get('traceparent')),
        attributes: serverSpanAttributes(request, url, id, context.get(clientKey), metricAttributes),
      }),
      Effect.catchTag('ServerErrorResponse', (error) => Effect.succeed(error.response)),
      Effect.annotateLogs({ requestId: id, method: request.method, path: url.pathname, route }),
    ),
  );
};

// ---------------------------------------------------------------------------
// Unmatched requests: recorded after the fact
// ---------------------------------------------------------------------------

/**
 * Middleware only runs for requests that match a route, so an unmatched URL
 * (a 404 from React Router itself) would otherwise leave no trace. This
 * records it after the fact: a back-dated `SERVER` span named after the method
 * only (there is no route), the HTTP duration metric and an access log.
 * Unlike matched requests, the response carries no `x-request-id` or
 * `Server-Timing` header: instrumentations can't touch the response.
 */
const observeUnmatched = (request: ReadonlyRequest, client: ClientInfo | undefined, startTime: bigint, statusCode: number) =>
  Effect.gen(function* () {
    const endTime = yield* Clock.currentTimeNanos;
    const tracer = yield* Effect.tracer;
    const parent = parseTraceparent(request.headers.get('traceparent'));
    const url = new URL(request.url);
    const id = requestIdOf(request);
    const metricAttributes = metricAttributesOf(request, 'unmatched', undefined);

    const span = tracer.span({
      name: request.method,
      parent: Option.fromUndefinedOr(parent),
      annotations: Context.empty(),
      links: [],
      startTime,
      kind: 'server',
      root: parent === undefined,
      sampled: parent?.sampled ?? true,
    });

    const attributes = {
      ...serverSpanAttributes(request, url, id, client, metricAttributes),
      'http.response.status_code': statusCode,
      'react_router.route.matched': false,
    };

    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        span.attribute(key, value);
      }
    }

    yield* recordRequestEnd(
      'request end (no route matched)',
      metricAttributes,
      statusCode,
      Duration.nanos(endTime - startTime),
    ).pipe(Effect.withParentSpan(span), Effect.annotateLogs({ requestId: id, method: request.method, path: url.pathname }));
    span.end(endTime, statusCode >= 500 ? Exit.fail(`HTTP ${statusCode}`) : Exit.void);
  });

// ---------------------------------------------------------------------------
// Loaders and actions
// ---------------------------------------------------------------------------

const handlerDuration = Metric.histogram('react_router.handler.duration', {
  description: 'Duration of route loaders and actions, by route id, handler type and outcome',
  boundaries: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  attributes: { unit: 's' },
});

type HandlerResult = { status: 'success'; error: undefined } | { status: 'error'; error: Error };

/**
 * What a handler's result means. Thrown `redirect()`s and `data(..., {status})`
 * are how routes answer, not failures, so only real errors mark the span.
 */
const handlerOutcome = (result: HandlerResult) => {
  if (result.status === 'success') {
    return { outcome: 'success', status: undefined } as const;
  }

  const { error } = result;

  if (error instanceof Response) {
    return { outcome: 'response', status: error.status } as const;
  }

  if (isRouteErrorResponse(error)) {
    return { outcome: 'response', status: error.status } as const;
  }

  return { outcome: 'error', status: undefined } as const;
};

const traceHandler =
  (handler: 'loader' | 'action', routeId: string) =>
  async (call: () => Promise<HandlerResult>, info: { context: ReadonlyContext; pattern: string }): Promise<void> => {
    const found = findMatched(info.context);
    if (found === undefined) {
      await call();
      return;
    }

    const attributes = {
      'react_router.handler': handler,
      'react_router.route.id': routeId,
      'http.route': normalizeRoute(info.pattern),
    };

    await found.runtime.runPromise(
      Effect.gen(function* () {
        const span = yield* Effect.currentSpan;
        const [elapsed, result] = yield* Effect.timed(Effect.promise(() => handlerSpanStorage.run(span, call)));
        const { outcome, status } = handlerOutcome(result);
        yield* Metric.update(Metric.withAttributes(handlerDuration, { ...attributes, outcome }), Duration.toSeconds(elapsed));
        yield* Effect.annotateCurrentSpan({
          'react_router.handler.outcome': outcome,
          ...(status === undefined ? {} : { 'react_router.handler.response_status': status }),
        });
        // Logged by `handleError`; failing here marks the span as an error.
        yield* outcome === 'error' ? Effect.fail(result.error) : Effect.void;
      }).pipe(
        Effect.withSpan(`${handler} ${routeId}`, { parent: found.request.span, attributes }),
        Effect.ignore,
        Effect.annotateLogs({ requestId: found.request.id }),
      ),
    );
  };

/**
 * React Router `instrumentations` (exported from `entry.server.tsx`):
 *
 * - a span and a duration metric for every loader and action, including
 *   routes that don't use Effect (e.g. `/healthz`);
 * - a server span, metric and log for requests that match no route.
 *
 * Middleware isn't instrumented here: the root middleware *is* the request
 * span, and wrapping it would put it in a separate trace.
 */
export const instrumentations: ServerInstrumentation[] = [
  {
    handler(handler) {
      handler.instrument({
        request: async (handle, { request, context }) => {
          const runtime = runtimeOf(context);

          if (runtime === undefined) {
            await handle();
            return;
          }

          const startTime = runtime.runSync(Clock.currentTimeNanos);
          const result = await handle();

          // Matched requests were traced by the root middleware.
          if (findMatched(context) !== undefined) {
            return;
          }

          await runtime.runPromise(observeUnmatched(request, clientOf(context), startTime, result.statusCode));
        },
      });
    },
    route(route) {
      route.instrument({
        loader: traceHandler('loader', route.id),
        action: traceHandler('action', route.id),
      });
    },
  },
];

// ---------------------------------------------------------------------------
// React server rendering
// ---------------------------------------------------------------------------

const renderDuration = Metric.histogram('react_router.render.duration', {
  description: 'Time from starting the React render to the first flushed byte (shell, or all content for bots)',
  boundaries: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  attributes: { unit: 's' },
});

const renderErrors = Metric.counter('react_router.render.errors', {
  description: 'Errors thrown while rendering React on the server, by phase (shell, stream)',
  incremental: true,
});

export interface RenderInfo {
  readonly routeId: string;
  readonly statusCode: number;
  readonly waitForAll: boolean;
}

/**
 * Wraps the React render (up to the moment the response starts streaming) in
 * a `react.render` span and records `react_router.render.duration`.
 */
export const traceRender = async (
  context: ReadonlyContext,
  info: RenderInfo,
  render: () => Promise<Response>,
): Promise<Response> => {
  const found = findMatched(context);

  if (found === undefined) {
    return render();
  }

  const attributes = { 'react_router.route.id': info.routeId };
  return found.runtime.runPromise(
    Effect.gen(function* () {
      const [elapsed, exit] = yield* Effect.timed(Effect.exit(Effect.tryPromise(render)));
      const outcome = exit._tag === 'Success' ? 'success' : 'error';
      yield* Metric.update(Metric.withAttributes(renderDuration, { ...attributes, outcome }), Duration.toSeconds(elapsed));
      if (outcome === 'error') {
        yield* Metric.update(Metric.withAttributes(renderErrors, { phase: 'shell' }), 1);
        yield* Effect.logError('React shell render failed', exit);
      }
      return yield* exit;
    }).pipe(
      Effect.withSpan('react.render', {
        parent: found.request.span,
        attributes: {
          ...attributes,
          'http.response.status_code': info.statusCode,
          'react.render.wait_for_all': info.waitForAll,
        },
      }),
      Effect.annotateLogs({ requestId: found.request.id }),
      // Reject with the original error, as the untraced render would.
      Effect.mapError((error) => error.cause),
    ),
  );
};

/** An error React reported while streaming the rest of the page (after the shell). */
export const logStreamError = (context: ReadonlyContext, error: unknown) =>
  observe(
    context,
    Effect.gen(function* () {
      yield* Metric.update(Metric.withAttributes(renderErrors, { phase: 'stream' }), 1);
      yield* Effect.logError('React streaming render error', error);
    }),
  );

/**
 * React Router's `handleError`: errors thrown by loaders, actions or the
 * render that it catches to show an ErrorBoundary. Aborted requests (the
 * client went away) are not errors.
 */
export const logServerError = (error: unknown, request: Request, context: ReadonlyContext | undefined) => {
  if (request.signal.aborted) {
    return;
  }

  observe(context, Effect.logError('unhandled server error', error));
};
