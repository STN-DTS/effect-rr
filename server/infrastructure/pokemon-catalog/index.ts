import { Config, Effect, Layer } from 'effect';

import type { PokemonCatalog } from '../../application/index.ts';
import { HttpPokemonCatalogLive } from './http/index.ts';
import { InMemoryPokemonCatalogLayer } from './in-memory/index.ts';
import { instrumented } from './instrumented.ts';

export const CATALOG_ADAPTERS = ['in-memory', 'http'] as const;
export type CatalogAdapter = (typeof CATALOG_ADAPTERS)[number];

/** `POKEMON_CATALOG=in-memory|http` (default: in-memory). */
export const CatalogAdapterConfig = Config.Literals(CATALOG_ADAPTERS, 'POKEMON_CATALOG').pipe(
  Config.withDefault<CatalogAdapter>('in-memory'),
);

/**
 * Every available implementation of the `PokemonCatalog` port. Checked with
 * `satisfies Record<…>` over the adapter names (keeping each layer's precise
 * error type), so adding a name without an adapter (or the
 * reverse) is a compile error.
 */
const ADAPTERS = {
  'in-memory': InMemoryPokemonCatalogLayer.pipe(instrumented('in-memory')),
  'http': HttpPokemonCatalogLive.pipe(instrumented('http')),
} satisfies Record<CatalogAdapter, Layer.Layer<PokemonCatalog, unknown>>;

/**
 * Picks the `PokemonCatalog` adapter at runtime from configuration.
 *
 * Both adapters satisfy the same port, so nothing outside this module knows
 * which one is running. Only the chosen layer is built: the in-memory adapter
 * never builds an HttpClient, and the http adapter never reads the dataset.
 * Each is wrapped in the same instrumentation (span, metrics and logs labelled
 * with the adapter name), so they can be compared side by side.
 */
export const PokemonCatalogLive = Layer.unwrap(
  Effect.gen(function* () {
    const adapter = yield* CatalogAdapterConfig;
    yield* Effect.logInfo('PokemonCatalog adapter selected').pipe(Effect.annotateLogs({ adapter }));
    return ADAPTERS[adapter];
  }),
);

export { instrumentCatalog, instrumented } from './instrumented.ts';
export * as Http from './http/index.ts';
export * as InMemory from './in-memory/index.ts';
