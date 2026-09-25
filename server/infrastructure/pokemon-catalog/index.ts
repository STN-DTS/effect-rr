import { Config, Effect, Layer } from 'effect';
import type { PokemonCatalog } from '~server/application';
import * as PokeApiCatalog from '~server/infrastructure/pokemon-catalog/http';
import * as InMemoryPokemonCatalog from '~server/infrastructure/pokemon-catalog/in-memory';
import { instrumented } from '~server/infrastructure/pokemon-catalog/instrumented.ts';

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
  'in-memory': InMemoryPokemonCatalog.layer.pipe(instrumented('in-memory')),
  'http': PokeApiCatalog.layer.pipe(instrumented('http')),
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
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const adapter = yield* CatalogAdapterConfig;
    yield* Effect.logInfo('PokemonCatalog adapter selected').pipe(Effect.annotateLogs({ adapter }));
    return ADAPTERS[adapter];
  }),
);

export * as PokeApiCatalog from '~server/infrastructure/pokemon-catalog/http';
export * as InMemoryPokemonCatalog from '~server/infrastructure/pokemon-catalog/in-memory';
export { instrumentCatalog, instrumented } from '~server/infrastructure/pokemon-catalog/instrumented.ts';
