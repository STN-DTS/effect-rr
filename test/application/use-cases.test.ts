import { assert, describe, it } from '@effect/vitest';
import { DateTime, Effect } from 'effect';
import { TestClock } from 'effect/testing';

import { clearRecentlyViewed, listRecentlyViewed, lookupPokemon } from '../../server/application/index.ts';
import { testAppLayer, UNAVAILABLE_CATALOG } from '../support/app.ts';

const TestLayer = testAppLayer();
const recentNames = listRecentlyViewed().pipe(Effect.map((es) => es.map((e) => e.name)));

describe('LookupPokemon', () => {
  it.effect('normalizes input, returns the Pokémon and records the view', () =>
    Effect.gen(function* () {
      const found = yield* lookupPokemon('  PIKACHU ');
      assert.strictEqual(found.name, 'pikachu');

      const [entry] = yield* listRecentlyViewed();
      assert.strictEqual(entry?.name, 'pikachu');
      assert.strictEqual(entry && DateTime.toEpochMillis(entry.viewedAt), 1_700_000_000_000);
    }).pipe(
      Effect.provide(TestLayer),
      // Set the clock before the app is built: jumping it afterwards would make the
      // runtime-metrics sampler catch up on every interval it "missed".
      (program) => Effect.andThen(TestClock.setTime(1_700_000_000_000), program),
    ),
  );

  it.effect('fails with InvalidPokemonName without touching the catalog or history', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(lookupPokemon('pika$chu'));
      assert.strictEqual(error._tag, 'InvalidPokemonName');
      assert.deepStrictEqual(yield* recentNames, []);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect('fails with PokemonNotFound and does not record the view', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(lookupPokemon('missingno'));
      assert.strictEqual(error._tag, 'PokemonNotFound');
      assert.deepStrictEqual(yield* recentNames, []);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect('propagates CatalogUnavailable', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(lookupPokemon('pikachu'));
      assert.strictEqual(error._tag, 'CatalogUnavailable');
    }).pipe(Effect.provide(testAppLayer(UNAVAILABLE_CATALOG))),
  );
});

describe('ListRecentlyViewed / ClearRecentlyViewed', () => {
  it.effect('lists most recent first without duplicates, then clears', () =>
    Effect.gen(function* () {
      yield* lookupPokemon('bulbasaur');
      yield* lookupPokemon('pikachu');
      yield* lookupPokemon('bulbasaur');
      assert.deepStrictEqual(yield* recentNames, ['bulbasaur', 'pikachu']);

      yield* clearRecentlyViewed();
      assert.deepStrictEqual(yield* recentNames, []);
    }).pipe(Effect.provide(TestLayer)),
  );
});
