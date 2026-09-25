import { Effect, Metric } from 'effect';
import type { InstrumentationServerHandlerResult, RouterContextProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RequestScope } from '~/lib/request.server.ts';
import { createAppLoadContext, instrumentations, requestMiddleware, requestScope } from '~/lib/request.server.ts';

import { makeTestRuntime } from '../support/app.ts';

let runtime: ReturnType<typeof makeTestRuntime>;
beforeEach(() => {
  runtime = makeTestRuntime();
});
afterEach(() => runtime.dispose());

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT_ID = '00f067aa0ba902b7';

/** Runs the root middleware for one request, capturing the scope a loader would see. */
const invoke = async (
  headers: Record<string, string> = {},
  { pattern = '/', status = 200, context = createAppLoadContext(runtime) } = {},
) => {
  const request = new Request('http://localhost/', { headers });
  let scope: RequestScope | undefined;
  const response = (await requestMiddleware({ request, context, params: {}, url: new URL(request.url), pattern }, async () => {
    scope = requestScope(context);
    return new Response('ok', { status });
  })) as Response;
  if (scope === undefined) {
    throw new Error('next() was not called');
  }
  return { response, scope };
};

const spanName = (scope: RequestScope) => (scope.parentSpan?._tag === 'Span' ? scope.parentSpan.name : undefined);

describe('requestMiddleware', () => {
  it('opens a scope on the app runtime', async () => {
    const { scope } = await invoke();
    expect(scope.runtime).toBe(runtime);
    expect(scope.signal).toBeInstanceOf(AbortSignal);
  });

  it('assigns a request id and echoes it on the response', async () => {
    const { response, scope } = await invoke();
    expect(scope.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('x-request-id')).toBe(scope.id);
  });

  it('reuses a well-formed incoming x-request-id and ignores malformed ones', async () => {
    expect((await invoke({ 'x-request-id': 'abc-123' })).scope.id).toBe('abc-123');
    expect((await invoke({ 'x-request-id': 'bad id!' })).scope.id).not.toBe('bad id!');
  });

  it('names the server span after the method and absolute route', async () => {
    expect(spanName((await invoke({}, { pattern: 'pokemon/:name' })).scope)).toBe('GET /pokemon/:name');
    expect(spanName((await invoke({}, { pattern: '' })).scope)).toBe('GET /');
  });

  it('returns the trace in a Server-Timing header', async () => {
    const { response } = await invoke();
    expect(response.headers.get('server-timing')).toMatch(/^traceparent;desc="00-[0-9a-f]{32}-[0-9a-f]{16}-01", total;dur=/);
  });

  it('still returns 5xx responses', async () => {
    const { response } = await invoke({}, { status: 503 });
    expect(response.status).toBe(503);
    expect(response.headers.get('x-request-id')).not.toBeNull();
  });
});

describe('trace continuation (traceparent)', () => {
  it('continues the caller’s trace, as a child of its span', async () => {
    const { response, scope } = await invoke({ traceparent: `00-${TRACE_ID}-${PARENT_ID}-01` });
    expect(response.headers.get('server-timing')).toContain(`00-${TRACE_ID}-`);
    expect(response.headers.get('server-timing')).not.toContain(PARENT_ID);
    expect(scope.parentSpan?.sampled).toBe(true);
  });

  it('honours the caller’s sampling decision', async () => {
    const { scope } = await invoke({ traceparent: `00-${TRACE_ID}-${PARENT_ID}-00` });
    expect(scope.parentSpan?.traceId).toBe(TRACE_ID);
    expect(scope.parentSpan?.sampled).toBe(false);
  });

  it.each([
    ['garbage', 'garbage'],
    ['an unknown version', `01-${TRACE_ID}-${PARENT_ID}-01`],
    ['an all-zero trace id', `00-${'0'.repeat(32)}-${PARENT_ID}-01`],
    ['an all-zero parent id', `00-${TRACE_ID}-${'0'.repeat(16)}-01`],
  ])('starts a new trace for %s', async (_, traceparent) => {
    const { scope } = await invoke({ traceparent });
    expect(scope.parentSpan?.traceId).not.toBe(TRACE_ID);
    expect(scope.parentSpan?.traceId).not.toMatch(/^0+$/);
  });
});

describe('instrumentations: unmatched requests', () => {
  type RequestInstrument = (
    handle: () => Promise<InstrumentationServerHandlerResult>,
    info: { request: Request; context: RouterContextProvider },
  ) => Promise<void>;

  const requestInstrument = (): RequestInstrument => {
    let instrument: RequestInstrument | undefined;
    for (const instrumentation of instrumentations) {
      instrumentation.handler?.({
        instrument: ({ request }) => {
          instrument = request;
        },
      });
    }
    if (instrument === undefined) {
      throw new Error('no request instrumentation');
    }
    return instrument;
  };

  const unmatched404s = () =>
    runtime.runPromise(
      Metric.snapshot.pipe(
        Effect.map((snapshots) =>
          snapshots
            .filter(
              (snapshot) =>
                snapshot.id === 'http.server.request.duration'
                && snapshot.type === 'Histogram'
                && snapshot.attributes?.['react_router.request.type'] === 'unmatched'
                && snapshot.attributes['http.response.status_code'] === '404',
            )
            .reduce((total, snapshot) => total + ('count' in snapshot.state ? Number(snapshot.state.count) : 0), 0),
        ),
      ),
    );

  const answered = (statusCode: number) => async (): Promise<InstrumentationServerHandlerResult> => ({
    status: 'success',
    error: undefined,
    statusCode,
    meta: undefined,
  });

  it('records a request that matched no route', async () => {
    const before = await unmatched404s();
    await requestInstrument()(answered(404), {
      request: new Request('http://localhost/nowhere'),
      context: createAppLoadContext(runtime),
    });
    expect((await unmatched404s()) - before).toBe(1);
  });

  it('leaves matched requests to the root middleware', async () => {
    const before = await unmatched404s();
    const context = createAppLoadContext(runtime);
    await requestInstrument()(
      async () => {
        await invoke({}, { context, status: 404 });
        return answered(404)();
      },
      { request: new Request('http://localhost/'), context },
    );
    expect((await unmatched404s()) - before).toBe(0);
  });
});
