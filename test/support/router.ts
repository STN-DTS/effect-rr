import type { RouterContextProvider } from 'react-router';

import { createAppLoadContext, requestMiddleware } from '~/lib/request.server.ts';

import type { AppRuntime } from '../../server/runtime.ts';

/**
 * Runs `handle` inside a request scope, exactly as `server.ts` + the root
 * middleware would set it up, and returns what it returned (or rejects with
 * what it threw). The middleware only sees a placeholder response.
 */
export const inRequest = async <A>(
  runtime: AppRuntime,
  request: Request,
  handle: (context: RouterContextProvider) => A | Promise<A>,
): Promise<A> => {
  const context = createAppLoadContext(runtime);
  let outcome: { ok: true; value: A } | { ok: false; error: unknown } | undefined;

  await requestMiddleware({ request, context, params: {}, url: new URL(request.url), pattern: '' }, async () => {
    try {
      outcome = { ok: true, value: await handle(context) };
    } catch (error) {
      outcome = { ok: false, error };
    }

    return new Response(null, { status: 204 });
  });

  if (outcome === undefined) {
    throw new Error('the request middleware did not call next()');
  }

  if (!outcome.ok) {
    throw outcome.error;
  }

  return outcome.value;
};

/** Minimal LoaderArgs/ActionArgs for calling route functions directly. */
interface RouteArgs<P> {
  readonly request: Request;
  readonly url: URL;
  readonly params: P;
  readonly pattern: string;
  readonly context: RouterContextProvider;
}

/** Calls a route loader/action the way React Router would: inside the root middleware. */
export const callRoute = <P extends Record<string, string>, A>(
  handler: (args: RouteArgs<P>) => A | Promise<A>,
  runtime: AppRuntime,
  url: string,
  params: P,
  init?: RequestInit,
): Promise<A> => {
  const request = new Request(new URL(url, 'http://localhost'), init);

  return inRequest(runtime, request, (context) => {
    return handler({ request, url: new URL(request.url), params, pattern: '', context });
  });
};

/** Awaits a route function that is expected to throw, returning what it threw. */
export const thrown = async (promise: unknown): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error('expected the route function to throw');
};
