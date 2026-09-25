import { assert, describe, it } from '@effect/vitest';
import { Effect, Metric } from 'effect';

import { lookupPokemon, PokemonCatalog } from '../../server/application/index.ts';
import { PokemonName, PokemonNotFound } from '../../server/domain/index.ts';
import { instrumentCatalog } from '../../server/infrastructure/pokemon-catalog/index.ts';
import { testAppLayer, UNAVAILABLE_CATALOG } from '../support/app.ts';
import { pikachu } from '../support/pokemon.ts';

// Metrics live in a process-wide registry. Tests read them back from a
// registry snapshot, by name and attributes, and compare before/after so they
// stay independent of test order.

const counterValue = (name: string, attributes: Record<string, string>) =>
  Metric.snapshot.pipe(
    Effect.map((snapshots) =>
      snapshots
        .filter(
          (snapshot) =>
            snapshot.id === name
            && snapshot.type === 'Counter'
            && Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
        )
        .reduce((total, snapshot) => total + ('count' in snapshot.state ? Number(snapshot.state.count) : 0), 0),
    ),
  );

const delta = <A, E, R>(read: Effect.Effect<number>, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const before = yield* read;
    yield* Effect.exit(effect);
    return (yield* read) - before;
  });

describe('LookupPokemon business metrics', () => {
  const layer = testAppLayer();

  it.effect('counts lookups by outcome', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* delta(counterValue('pokemon.lookups', { outcome: 'found' }), lookupPokemon('pikachu')), 1);
      assert.strictEqual(
        yield* delta(counterValue('pokemon.lookups', { outcome: 'PokemonNotFound' }), lookupPokemon('missingno')),
        1,
      );
      assert.strictEqual(
        yield* delta(counterValue('pokemon.lookups', { outcome: 'InvalidPokemonName' }), lookupPokemon('pika$chu')),
        1,
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect('counts unavailable-catalog lookups', () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* delta(counterValue('pokemon.lookups', { outcome: 'CatalogUnavailable' }), lookupPokemon('pikachu')),
        1,
      );
    }).pipe(Effect.provide(testAppLayer(UNAVAILABLE_CATALOG))),
  );

  it.effect('counts views per Pokémon and per type (both types of a dual-type Pokémon)', () =>
    Effect.gen(function* () {
      const views = counterValue('pokemon.views', { 'pokemon.name': 'bulbasaur' });
      const grass = counterValue('pokemon.type.views', { 'pokemon.type': 'grass' });
      const poison = counterValue('pokemon.type.views', { 'pokemon.type': 'poison' });
      const all = Effect.all([views, grass, poison]).pipe(Effect.map((values) => values.join(',')));

      const before = yield* all;
      yield* lookupPokemon('bulbasaur');
      const after = yield* all;
      assert.deepStrictEqual(
        after.split(',').map(Number),
        before.split(',').map((value) => Number(value) + 1),
      );
    }).pipe(Effect.provide(layer)),
  );
});

describe('instrumentCatalog (adapter decorator)', () => {
  const fake = PokemonCatalog.of({
    findByName: (name) => (name === 'pikachu' ? Effect.succeed(pikachu) : Effect.fail(new PokemonNotFound({ name }))),
  });
  const catalog = instrumentCatalog('fake')(fake);
  const requests = (outcome: string) =>
    counterValue('pokemon_catalog.requests', { 'pokemon_catalog.adapter': 'fake', outcome });

  it.effect('passes results through unchanged', () =>
    Effect.gen(function* () {
      const found = yield* catalog.findByName(PokemonName.make('pikachu'));
      assert.strictEqual(found, pikachu);
      const error = yield* Effect.flip(catalog.findByName(PokemonName.make('missingno')));
      assert.strictEqual(error._tag, 'PokemonNotFound');
    }),
  );

  it.effect('counts requests by adapter and outcome', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* delta(requests('found'), catalog.findByName(PokemonName.make('pikachu'))), 1);
      assert.strictEqual(yield* delta(requests('not_found'), catalog.findByName(PokemonName.make('missingno'))), 1);
    }),
  );
});
