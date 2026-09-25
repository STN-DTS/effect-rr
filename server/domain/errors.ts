import { Schema } from 'effect';

export class InvalidPokemonName extends Schema.TaggedError<InvalidPokemonName>()('InvalidPokemonName', {
  input: Schema.String,
  message: Schema.String,
}) {}

export class PokemonNotFound extends Schema.TaggedError<PokemonNotFound>()('PokemonNotFound', {
  // Plain string rather than PokemonName to keep errors free of cycles; it is
  // always a canonical name when produced by the catalog.
  name: Schema.String,
}) {}
