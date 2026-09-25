import { Option, Schema } from 'effect';

/** The subset of `GET /pokemon/{name}` this adapter reads. Unknown fields are ignored. */
export const PokeApiPokemon = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  height: Schema.Int,
  weight: Schema.Int,
  species: Schema.Struct({ name: Schema.String, url: Schema.String }),
  types: Schema.Array(Schema.Struct({ slot: Schema.Int, type: Schema.Struct({ name: Schema.String }) })),
  stats: Schema.Array(Schema.Struct({ base_stat: Schema.Int, stat: Schema.Struct({ name: Schema.String }) })),
  sprites: Schema.Struct({
    other: Schema.optionalKey(
      Schema.Struct({
        'official-artwork': Schema.optionalKey(
          Schema.Struct({ front_default: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
        ),
      }),
    ),
  }),
});
export type PokeApiPokemon = typeof PokeApiPokemon.Type;

const speciesId = (url: string): number => {
  const match = /\/pokemon-species\/(\d+)\/?$/.exec(url);
  return match?.[1] === undefined ? Number.NaN : Number(match[1]);
};

/**
 * Anti-corruption mapping from the external payload to the *encoded* shape of
 * the domain aggregate. The result is deliberately loosely typed: it is
 * validated by decoding it with the domain `Pokemon` schema, so an unknown
 * type or an out-of-range stat is rejected rather than trusted.
 */
export const toPokemonInput = (dto: PokeApiPokemon): unknown => ({
  name: dto.name,
  // `id` is a form id for alternate forms; the species id is the national dex number.
  dexNumber: speciesId(dto.species.url),
  types: dto.types.toSorted((a, b) => a.slot - b.slot).map((t) => t.type.name),
  height: dto.height,
  weight: dto.weight,
  baseStats: dto.stats.map((s) => ({ stat: s.stat.name, value: s.base_stat })),
  artworkUrl: Option.fromNullishOr(dto.sprites.other?.['official-artwork']?.front_default),
});
