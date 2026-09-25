import { Effect, Schema, SchemaIssue, SchemaTransformation } from 'effect';

import { InvalidPokemonName } from './errors.ts';

export const POKEMON_NAME_MAX_LENGTH = 40;

/**
 * A canonical Pokémon identifier as used by the national catalog:
 * lowercase ASCII letters and digits, separated by single hyphens.
 * (Digits are allowed because the catalog also resolves dex numbers.)
 */
export const PokemonName = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1, { message: 'Enter a Pokémon name.' }),
    Schema.isMaxLength(POKEMON_NAME_MAX_LENGTH, {
      message: `Names are at most ${POKEMON_NAME_MAX_LENGTH} characters.`,
    }),
    Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'Use only letters, digits and single hyphens.',
    }),
  ),
  Schema.brand('PokemonName'),
);
export type PokemonName = typeof PokemonName.Type;

/** Normalizes free-form user input: trims, lowercases, turns inner whitespace into hyphens. */
export const normalizePokemonName = (input: string): string => input.trim().toLowerCase().replace(/\s+/g, '-');

/** Decodes raw user input (e.g. `"  Mr Mime "`) into a canonical {@link PokemonName}. */
export const PokemonNameFromInput = Schema.String.pipe(
  Schema.decodeTo(
    PokemonName,
    SchemaTransformation.transform({
      decode: normalizePokemonName,
      encode: (name) => name,
    }),
  ),
);

const formatIssue = SchemaIssue.makeFormatterDefault();
const decodeInput = Schema.decodeUnknownEffect(PokemonNameFromInput);

/** Parses untrusted input, failing with the domain error {@link InvalidPokemonName}. */
export const parsePokemonName = (input: string): Effect.Effect<PokemonName, InvalidPokemonName> => {
  return decodeInput(input).pipe(
    Effect.mapError((error) => new InvalidPokemonName({ input, message: formatIssue(error.issue) })),
  );
};
