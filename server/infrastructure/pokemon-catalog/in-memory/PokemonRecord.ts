import { Option, Schema, SchemaTransformation } from 'effect';

import { Pokemon, PokemonType, StatName } from '../../../domain/index.ts';

/**
 * On-disk shape of one Pokémon in the dataset file: plain JSON (no Option,
 * no brands). Enum-like fields reuse the domain literals so a bad file is
 * rejected at load time.
 */
export const PokemonRecord = Schema.Struct({
  name: Schema.String,
  dexNumber: Schema.Number,
  types: Schema.NonEmptyArray(PokemonType),
  height: Schema.Number,
  weight: Schema.Number,
  baseStats: Schema.Array(Schema.Struct({ stat: StatName, value: Schema.Number })),
  artworkUrl: Schema.NullOr(Schema.String),
});
export type PokemonRecord = typeof PokemonRecord.Type;

/** Record <-> domain aggregate. Two-way: the adapter decodes, the dataset script encodes. */
export const PokemonFromRecord = PokemonRecord.pipe(
  Schema.decodeTo(
    Pokemon,
    SchemaTransformation.transform({
      decode: (record) => ({ ...record, artworkUrl: Option.fromNullishOr(record.artworkUrl) }),
      encode: (pokemon) => ({ ...pokemon, artworkUrl: Option.getOrNull(pokemon.artworkUrl) }),
    }),
  ),
);

/** The whole dataset file. */
export const PokemonDataset = Schema.Struct({
  source: Schema.String,
  generatedAt: Schema.String,
  pokemon: Schema.Array(PokemonFromRecord),
});
export type PokemonDataset = typeof PokemonDataset.Type;

/** JSON text <-> dataset. */
export const PokemonDatasetFromJson = Schema.fromJsonString(PokemonDataset);
