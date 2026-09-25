import { assert, describe, it } from '@effect/vitest';
import { ConfigProvider, Effect, Layer } from 'effect';

import { PokemonCatalog } from '../../../server/application/index.ts';
import { PokemonName } from '../../../server/domain/index.ts';
import { PokemonCatalogLive } from '../../../server/infrastructure/index.ts';

/** Builds the runtime-selected catalog from `env` and looks up pikachu. */
const lookupWith = (env: Record<string, string>) =>
  Effect.gen(function* () {
    const catalog = yield* PokemonCatalog;
    return yield* Effect.result(catalog.findByName(PokemonName.make('pikachu')));
  }).pipe(Effect.provide(PokemonCatalogLive.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))))));

// An address nothing listens on: any HTTP attempt fails fast with a transport error.
const UNREACHABLE = { POKEAPI_BASE_URL: 'http://127.0.0.1:9/api/v2', POKEAPI_RETRIES: '0' };
const DATASET = { POKEMON_DATASET_PATH: 'test/fixtures/dataset/pokemon.json' };

describe('PokemonCatalogLive (runtime adapter selection)', () => {
  it.live('defaults to the in-memory adapter (no network needed)', () =>
    Effect.gen(function* () {
      const result = yield* lookupWith({ ...DATASET, ...UNREACHABLE });
      assert.strictEqual(result._tag, 'Success');
    }),
  );

  it.live('POKEMON_CATALOG=in-memory selects the in-memory adapter explicitly', () =>
    Effect.gen(function* () {
      const result = yield* lookupWith({
        POKEMON_CATALOG: 'in-memory',
        ...DATASET,
        ...UNREACHABLE,
      });
      assert.strictEqual(result._tag, 'Success');
    }),
  );

  it.live('POKEMON_CATALOG=http selects the PokeAPI adapter (and never reads the dataset)', () =>
    Effect.gen(function* () {
      const result = yield* lookupWith({
        POKEMON_CATALOG: 'http',
        POKEMON_DATASET_PATH: 'does/not/exist.json',
        ...UNREACHABLE,
      });
      assert.isTrue(result._tag === 'Failure' && result.failure._tag === 'CatalogUnavailable');
    }),
  );

  it.live('rejects unknown adapter names at boot', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(lookupWith({ POKEMON_CATALOG: 'carrier-pigeon' }));
      assert.strictEqual(exit._tag, 'Failure');
    }),
  );
});
