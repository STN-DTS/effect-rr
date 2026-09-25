import { Schema } from 'effect';

import type { Pokemon } from './Pokemon.ts';
import { PokemonName } from './PokemonName.ts';
import { DexNumber } from './values.ts';

export const RECENTLY_VIEWED_LIMIT = 10;

export class RecentlyViewedEntry extends Schema.Class<RecentlyViewedEntry>('RecentlyViewedEntry')({
  name: PokemonName,
  dexNumber: DexNumber,
  viewedAt: Schema.DateTimeUtc,
}) {
  static fromPokemon(pokemon: Pokemon, viewedAt: typeof Schema.DateTimeUtc.Type) {
    return new RecentlyViewedEntry({ name: pokemon.name, dexNumber: pokemon.dexNumber, viewedAt });
  }
}

/**
 * "Recently viewed" aggregate. Invariants: most recent first, no duplicate
 * names, at most {@link RECENTLY_VIEWED_LIMIT} entries.
 */
export class RecentlyViewed extends Schema.Class<RecentlyViewed>('RecentlyViewed')({
  entries: Schema.Array(RecentlyViewedEntry).check(Schema.isMaxLength(RECENTLY_VIEWED_LIMIT)),
}) {
  static readonly empty = new RecentlyViewed({ entries: [] });

  record(entry: RecentlyViewedEntry): RecentlyViewed {
    const others = this.entries.filter((existing) => existing.name !== entry.name);
    return new RecentlyViewed({ entries: [entry, ...others].slice(0, RECENTLY_VIEWED_LIMIT) });
  }

  clear(): RecentlyViewed {
    return RecentlyViewed.empty;
  }
}
