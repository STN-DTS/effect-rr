/**
 * Minimal PokeAPI stand-in for Playwright. Serves the recorded fixtures from
 * test/fixtures/pokeapi so e2e never touches the real API.
 *
 *   GET /api/v2/pokemon/<fixture>  -> 200 fixture (artwork URLs rewritten to this server)
 *   GET /api/v2/pokemon/outage     -> 503 (exercises retry + 503 page)
 *   GET /api/v2/pokemon/<other>    -> 404
 *   GET /sprites/*                 -> 1x1 PNG
 *   GET /health                    -> 200
 */

import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.STUB_PORT ?? 4010);
const FIXTURES = fileURLToPath(new URL('../test/fixtures/pokeapi/', import.meta.url));
const SPRITES_ORIGIN = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/';
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const handle = (req: IncomingMessage, res: ServerResponse): void => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const self = `http://${req.headers.host}`;

  if (url.pathname === '/health') {
    res.writeHead(200).end('ok');
    return;
  }

  if (url.pathname.startsWith('/sprites/')) {
    res.writeHead(200, { 'content-type': 'image/png' }).end(PIXEL);
    return;
  }

  const match = /^\/api\/v2\/pokemon\/([^/]+)\/?$/.exec(url.pathname);
  const name = match?.[1] ? decodeURIComponent(match[1]) : undefined;

  if (name === 'outage') {
    res.writeHead(503, { 'content-type': 'text/plain' }).end('Service Unavailable');
    return;
  }

  const file = `${FIXTURES}${name}.json`;

  if (name !== undefined && /^[a-z0-9-]+$/.test(name) && existsSync(file)) {
    const body = readFileSync(file, 'utf8').replaceAll(SPRITES_ORIGIN, `${self}/sprites/`);
    res.writeHead(200, { 'content-type': 'application/json' }).end(body);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' }).end('Not Found');
};

const server = createServer(handle);

server.listen(PORT, '127.0.0.1', () => console.log(`PokeAPI stub on http://127.0.0.1:${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close());
}
