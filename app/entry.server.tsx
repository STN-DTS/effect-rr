/**
 * Server entry: React Router's default Node entry, plus observability hooks
 * (see `lib/request.server.ts`):
 *
 * - `instrumentations` traces and measures every loader and action;
 * - the render is traced up to the first flushed byte;
 * - streaming and caught server errors go to the Effect logger, not the console.
 */

import { PassThrough } from 'node:stream';

import { createReadableStreamFromReadable } from '@react-router/node';
import { isbot } from 'isbot';
import type { RenderToPipeableStreamOptions } from 'react-dom/server';
import { renderToPipeableStream } from 'react-dom/server';
import type { EntryContext, HandleErrorFunction, RouterContextProvider } from 'react-router';
import { ServerRouter } from 'react-router';

import { logServerError, logStreamError, traceRender } from './lib/request.server.ts';

export { instrumentations } from './lib/request.server.ts';

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  const userAgent = request.headers.get('user-agent');
  // Bots and SPA-mode renders wait for all content; browsers get the shell as soon as it's ready.
  const waitForAll = (userAgent !== null && isbot(userAgent)) || routerContext.isSpaMode;
  const readyOption: keyof RenderToPipeableStreamOptions = waitForAll ? 'onAllReady' : 'onShellReady';
  const routeId = routerContext.staticHandlerContext.matches.at(-1)?.route.id ?? 'unknown';

  return traceRender(
    loadContext,
    { routeId, statusCode: responseStatusCode, waitForAll },
    () =>
      new Promise<Response>((resolve, reject) => {
        let shellRendered = false;

        // Abort the rendering stream after `streamTimeout` so it has time to flush the rejected boundaries.
        let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

        const { pipe, abort } = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} />, {
          [readyOption]() {
            shellRendered = true;
            const body = new PassThrough({
              final(callback) {
                // Clear the timeout to prevent retaining the closure and leaking memory.
                clearTimeout(timeoutId);
                timeoutId = undefined;
                callback();
              },
            });
            const stream = createReadableStreamFromReadable(body);

            responseHeaders.set('Content-Type', 'text/html');
            pipe(body);
            resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
          },
          onShellError(error: unknown) {
            reject(error);
          },
          onError(error: unknown) {
            responseStatusCode = 500;
            // Errors during the shell reject and are logged by traceRender/handleError.
            if (shellRendered) {
              logStreamError(loadContext, error);
            }
          },
        });
      }),
  );
}

export const handleError: HandleErrorFunction = (error, { request, context }) => {
  logServerError(error, request, context);
};
