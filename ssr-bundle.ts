/**
 * Entry of the SSR bundle (build/server/index.js). It re-exports the React
 * Router server build together with the Effect runtime, so that the process
 * entry (`server.ts`) and the route modules share one module graph — and
 * therefore the same router-context keys.
 */

import * as build from 'virtual:react-router/server-build';

import type { AppRuntime } from './server/runtime.ts';
import { makeRuntime } from './server/runtime.ts';

export { createAppLoadContext } from './app/lib/request.server.ts';
export { loadServerConfig } from './server/runtime.ts';
export type { AppRuntime } from './server/runtime.ts';
export { build };

const globalForRuntime = globalThis as typeof globalThis & {
  __pokedexRuntime?: AppRuntime;
};

/**
 * The single process-wide runtime. In dev, Vite re-evaluates this module
 * whenever something in its graph changes (HMR); caching on `globalThis`
 * keeps the runtime — and the state in its layers, like the in-memory
 * repository — alive across those reloads. Restart the process to pick up
 * changes to layers/adapters.
 */
export const getProcessRuntime = (): AppRuntime => {
  return (globalForRuntime.__pokedexRuntime ??= makeRuntime());
};
