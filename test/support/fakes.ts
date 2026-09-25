import { Effect, Layer, Ref } from 'effect';

import { CatalogUnavailable, PokemonCatalog, RecentlyViewedRepository } from '../../server/application/index.ts';
import type { Pokemon } from '../../server/domain/index.ts';
import { PokemonNotFound, RecentlyViewed } from '../../server/domain/index.ts';

/** Names that make the fake catalog fail, to exercise error paths. */
export const UNAVAILABLE_NAME = 'unavailable';
export const DEFECT_NAME = 'defect';

export const fakeCatalogLayer = (pokemon: ReadonlyArray<Pokemon>) =>
  Layer.succeed(
    PokemonCatalog,
    PokemonCatalog.of({
      findByName: (name) => {
        if (name === DEFECT_NAME) {
          return Effect.die(new Error('fake catalog bug'));
        }

        if (name === UNAVAILABLE_NAME) {
          return Effect.fail(new CatalogUnavailable({ reason: 'UpstreamFailure', message: 'fake outage' }));
        }

        const found = pokemon.find((p) => p.name === name || String(p.dexNumber) === name);
        return found ? Effect.succeed(found) : Effect.fail(new PokemonNotFound({ name }));
      },
    }),
  );

export const refRecentlyViewedLayer = Layer.effect(
  RecentlyViewedRepository,
  Effect.gen(function* () {
    const ref = yield* Ref.make(RecentlyViewed.empty);
    return RecentlyViewedRepository.of({
      get: Ref.get(ref),
      update: (f) => Ref.update(ref, f),
    });
  }),
);

export const testAppLayer = (pokemon: ReadonlyArray<Pokemon>) =>
  Layer.mergeAll(fakeCatalogLayer(pokemon), refRecentlyViewedLayer);
