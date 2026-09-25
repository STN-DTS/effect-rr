import { assert, describe, it } from '@effect/vitest';
import { ConfigProvider, Effect, Layer, Option } from 'effect';

import { PokemonCatalog } from '../../../server/application/index.ts';
import { PokemonName } from '../../../server/domain/index.ts';
import { InMemoryPokemonCatalogLayer } from '../../../server/infrastructure/pokemon-catalog/in-memory/index.ts';

const FIXTURE = 'test/fixtures/dataset/pokemon.json';

const withDataset = (path: string) =>
  InMemoryPokemonCatalogLayer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ POKEMON_DATASET_PATH: path }))),
  );

const find = (name: string, path = FIXTURE) =>
  Effect.gen(function* () {
    const catalog = yield* PokemonCatalog;
    return yield* Effect.result(catalog.findByName(PokemonName.make(name)));
  }).pipe(Effect.provide(withDataset(path)));

describe('InMemoryPokemonCatalog', () => {
  it.effect('finds a Pokémon by canonical name, as a full domain aggregate', () =>
    Effect.gen(function* () {
      const result = yield* find('pikachu');
      assert.isTrue(result._tag === 'Success');

      if (result._tag !== 'Success') {
        return;
      }

      assert.strictEqual(result.success.dexNumber, 25);
      assert.deepStrictEqual(result.success.types, ['electric']);
      assert.strictEqual(result.success.baseStats.length, 6);
      assert.isTrue(Option.isSome(result.success.artworkUrl));
    }),
  );

  it.effect('resolves a dex number to the default form', () =>
    Effect.gen(function* () {
      const result = yield* find('386');
      assert.isTrue(result._tag === 'Success' && result.success.name === 'deoxys-normal');
    }),
  );

  it.effect('fails with PokemonNotFound for unknown names', () =>
    Effect.gen(function* () {
      const result = yield* find('missingno');
      assert.isTrue(result._tag === 'Failure' && result.failure._tag === 'PokemonNotFound');
    }),
  );

  it.effect('fails to build (boot error) when the dataset is missing', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(find('pikachu', 'test/fixtures/dataset/nope.json'));
      assert.strictEqual(error._tag, 'CatalogDatasetError');
    }),
  );

  it.effect('fails to build when the dataset violates the schema', () =>
    Effect.gen(function* () {
      // A recorded PokeAPI payload is valid JSON but not a dataset.
      const error = yield* Effect.flip(find('pikachu', 'test/fixtures/pokeapi/pikachu.json'));
      assert.strictEqual(error._tag, 'CatalogDatasetError');

      if (error._tag === 'CatalogDatasetError') {
        assert.include(error.message, 'invalid dataset');
      }
    }),
  );

  it.effect('the committed dataset (data/pokemon.json) loads completely', () =>
    Effect.gen(function* () {
      for (const [name, dex] of [
        ['bulbasaur', 1],
        ['pikachu', 25],
        ['mr-mime', 122],
        ['1025', 1025],
      ] as const) {
        const result = yield* find(name, 'data/pokemon.json');
        assert.isTrue(result._tag === 'Success', `expected ${name}`);

        if (result._tag === 'Success') {
          assert.strictEqual<number>(result.success.dexNumber, dex);
        }
      }
    }),
  );
});
