import { assert, describe, it } from '@effect/vitest';
import { Effect, Result, Schema } from 'effect';

import { normalizePokemonName, parsePokemonName, POKEMON_NAME_MAX_LENGTH, PokemonName } from '../../server/domain/index.ts';

describe('PokemonName', () => {
  it.effect.each([
    { input: 'pikachu', expected: 'pikachu' },
    { input: '  Pikachu ', expected: 'pikachu' },
    { input: 'MR MIME', expected: 'mr-mime' },
    { input: 'ho-oh', expected: 'ho-oh' },
    { input: '25', expected: '25' },
  ])('normalizes $input -> $expected', ({ input, expected }) =>
    Effect.gen(function* () {
      const name = yield* parsePokemonName(input);
      assert.strictEqual(name, expected);
    }),
  );

  it.effect.each([
    { input: '', message: 'Enter a Pokémon name.' },
    { input: '   ', message: 'Enter a Pokémon name.' },
    { input: 'pika$chu', message: 'Use only letters, digits and single hyphens.' },
    { input: 'mr.-mime', message: 'Use only letters, digits and single hyphens.' },
    { input: '-pikachu', message: 'Use only letters, digits and single hyphens.' },
    { input: 'a'.repeat(POKEMON_NAME_MAX_LENGTH + 1), message: 'Names are at most 40 characters.' },
  ])('rejects $input', ({ input, message }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parsePokemonName(input));
      assert.strictEqual(error._tag, 'InvalidPokemonName');
      assert.strictEqual(error.input, input);
      assert.strictEqual(error.message, message);
    }),
  );

  // Every valid canonical name survives normalization unchanged (idempotence).
  it.prop('canonical names are fixed points of normalization', [PokemonName], ([name]) => {
    assert.strictEqual(normalizePokemonName(name), name);
  });

  // Every value accepted by parsePokemonName satisfies the canonical schema.
  it.effect.prop('parsed input is always canonical', [Schema.String], ([input]) =>
    Effect.gen(function* () {
      const result = yield* Effect.result(parsePokemonName(input));
      if (Result.isSuccess(result)) {
        assert.isTrue(Schema.is(PokemonName)(result.success));
        assert.isTrue(result.success.length <= POKEMON_NAME_MAX_LENGTH);
      } else {
        assert.strictEqual(result.failure._tag, 'InvalidPokemonName');
      }
    }),
  );
});
