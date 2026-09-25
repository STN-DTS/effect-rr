import { DateTime, Effect, Metric } from 'effect';

import type { Pokemon } from '../../domain/index.ts';
import { parsePokemonName, RecentlyViewedEntry } from '../../domain/index.ts';
import { PokemonCatalog } from '../ports/PokemonCatalog.ts';
import { RecentlyViewedRepository } from '../ports/RecentlyViewedRepository.ts';

// Business metrics: what users look up, not how the lookup is served (the
// catalog adapters measure that). Cardinality is bounded by the catalog.

const lookups = Metric.counter('pokemon.lookups', {
  description: 'Pokémon lookups, by outcome (found or the failure tag)',
  incremental: true,
});

const views = Metric.counter('pokemon.views', {
  description: 'Successful Pokémon lookups, by Pokémon (the "most viewed" leaderboard)',
  incremental: true,
});

const typeViews = Metric.counter('pokemon.type.views', {
  description: 'Successful Pokémon lookups, by Pokémon type (dual-type Pokémon count for both)',
  incremental: true,
});

const countLookup = (outcome: string) => Metric.update(Metric.withAttributes(lookups, { outcome }), 1);

const recordView = (pokemon: Pokemon) =>
  Effect.gen(function* () {
    yield* countLookup('found');
    yield* Metric.update(Metric.withAttributes(views, { 'pokemon.name': pokemon.name }), 1);
    for (const type of pokemon.types) {
      yield* Metric.update(Metric.withAttributes(typeViews, { 'pokemon.type': type }), 1);
    }
  });

/**
 * Looks up a Pokémon by (untrusted) name and records the successful view.
 * Fails with `InvalidPokemonName`, `PokemonNotFound` or `CatalogUnavailable`.
 */
export const lookupPokemon = Effect.fn('LookupPokemon')(
  function* (rawName: string) {
    yield* Effect.annotateCurrentSpan({ 'pokemon.query': rawName });
    const name = yield* parsePokemonName(rawName);
    yield* Effect.annotateCurrentSpan({ 'pokemon.name': name });

    const catalog = yield* PokemonCatalog;
    const repository = yield* RecentlyViewedRepository;

    const pokemon = yield* catalog.findByName(name);
    const viewedAt = yield* DateTime.now;

    yield* repository.update((list) => list.record(RecentlyViewedEntry.fromPokemon(pokemon, viewedAt)));

    yield* Effect.annotateCurrentSpan({
      'pokemon.dex_number': pokemon.dexNumber,
      'pokemon.types': pokemon.types.join(','),
    });

    yield* Effect.logInfo('Pokémon viewed').pipe(
      Effect.annotateLogs({
        'pokemon.name': pokemon.name,
        'pokemon.dex_number': pokemon.dexNumber,
        'pokemon.types': pokemon.types.join(','),
      }),
    );

    return pokemon;
  },
  Effect.tap(recordView),
  Effect.tapError((error) =>
    Effect.gen(function* () {
      yield* countLookup(error._tag);
      yield* Effect.annotateCurrentSpan({ 'pokemon.lookup.outcome': error._tag });
      // Expected outcomes (bad input, unknown name) are routine: log them quietly.
      // CatalogUnavailable is already logged, with details, by the catalog.
      yield* Effect.logDebug('Pokémon lookup failed').pipe(
        Effect.annotateLogs({ outcome: error._tag, error: error.message || error._tag }),
      );
    }),
  ),
);
