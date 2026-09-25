/**
 * Process entry: one Node process serves static assets, SSR, loaders and
 * actions. Runs directly under Node's type stripping in dev (`node server.ts`)
 * and is compiled to build/server.js for production.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createRequestListener } from '@react-router/node';
import type { ServerBuild } from 'react-router';
import sirv from 'sirv';

import type * as SsrBundle from './ssr-bundle.ts';

type Bundle = typeof SsrBundle;
type Next = () => void;

const DEV = process.env.NODE_ENV === 'development';

// ---------------------------------------------------------------------------
// Load the SSR bundle (via Vite in dev, from disk in production)
// ---------------------------------------------------------------------------

let loadBundle: () => Promise<Bundle>;
let assets: (req: IncomingMessage, res: ServerResponse, next: Next) => void;
let closeVite = async () => {};

if (DEV) {
  const vite = await import('vite').then((m) => {
    return m.createServer({ server: { middlewareMode: true } });
  });

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ssrLoadModule is untyped
  loadBundle = () => vite.ssrLoadModule('./ssr-bundle.ts') as Promise<Bundle>;

  assets = vite.middlewares;
  closeVite = () => vite.close();

  // Vite installs a SIGTERM handler that calls process.exit() after closing
  // itself, which would race our drain + runtime.dispose(). We own shutdown.
  process.removeAllListeners('SIGTERM');
} else {
  const bundle: Bundle = await import(
    // The compiled form of ssr-bundle.ts, produced by `react-router build`.
    pathToFileURL(resolve('build/server/index.js')).href
  );

  loadBundle = async () => bundle;

  // Hashed build output under /assets never changes: cache it forever.
  assets = sirv('build/client', {
    etag: true,
    setHeaders: (res, pathname) => {
      res.setHeader(
        'Cache-Control',
        pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Runtime: built once per process (see getProcessRuntime in ssr-bundle.ts).
// ---------------------------------------------------------------------------

const initial = await loadBundle();
const runtime = initial.getProcessRuntime();

// Build every layer eagerly so misconfiguration fails at boot, not on the first request.
await runtime.context();
const config = await initial.loadServerConfig(runtime);

const handleRequest = createRequestListener({
  // In dev, re-import per request so route changes are picked up; in production this is memoized.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- RR's virtual-module typings predate exactOptionalPropertyTypes
  build: async () => (await loadBundle()).build as unknown as ServerBuild,

  getLoadContext: async (_request, client) => {
    const bundle = await loadBundle();
    return bundle.createAppLoadContext(bundle.getProcessRuntime(), { address: client.address, port: client.port });
  },

  mode: DEV ? 'development' : 'production',
});

const server = createServer((req, res) => {
  assets(req, res, () => {
    handleRequest(req, res);
  });
});

server.listen(config.port, config.host, () => {
  console.log(`Pokédex listening on http://${config.host}:${config.port} (${DEV ? 'development' : 'production'})`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown: stop accepting, drain, then dispose the runtime.
// ---------------------------------------------------------------------------

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(`${signal} received: draining connections`);

  const forceTimer = setTimeout(() => {
    console.warn('Drain timeout reached: closing remaining connections');
    server.closeAllConnections();
  }, config.shutdownTimeoutMs);

  forceTimer.unref();

  await new Promise<void>((done) => {
    server.close(() => done());
    server.closeIdleConnections();
  });

  await closeVite();
  await runtime.dispose();

  console.log('Shutdown complete');
  process.exit(0);
};

process.once('SIGTERM', (s) => void shutdown(s));
process.once('SIGINT', (s) => void shutdown(s));
