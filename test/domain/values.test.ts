import { assert, describe, it } from '@effect/vitest';
import { Schema } from 'effect';

import {
  BaseStatValue,
  DexNumber,
  Height,
  heightInMetres,
  PokemonType,
  Weight,
  weightInKilograms,
} from '../../server/domain/index.ts';

const accepts = (schema: Schema.Top & { readonly DecodingServices: never }, input: unknown) => Schema.is(schema)(input);

describe('value objects', () => {
  it('DexNumber accepts positive integers within range', () => {
    assert.isTrue(accepts(DexNumber, 1));
    assert.isTrue(accepts(DexNumber, 1025));
    assert.isFalse(accepts(DexNumber, 0));
    assert.isFalse(accepts(DexNumber, 1.5));
    assert.isFalse(accepts(DexNumber, '25'));
  });

  it('PokemonType only accepts the 18 canonical types', () => {
    assert.isTrue(accepts(PokemonType, 'electric'));
    assert.isFalse(accepts(PokemonType, 'Electric'));
    assert.isFalse(accepts(PokemonType, 'shadow'));
  });

  it('BaseStatValue is bounded 1..255', () => {
    assert.isTrue(accepts(BaseStatValue, 255));
    assert.isFalse(accepts(BaseStatValue, 0));
    assert.isFalse(accepts(BaseStatValue, 256));
  });

  it('Height and Weight convert to human units', () => {
    assert.strictEqual(heightInMetres(Height.make(4)), 0.4);
    assert.strictEqual(weightInKilograms(Weight.make(60)), 6);
    assert.isFalse(accepts(Height, -1));
  });

  it.prop('heights round-trip through metres', [Height], ([height]) => {
    assert.strictEqual(Math.round(heightInMetres(height) * 10), height);
  });

  it.prop('any decoded weight is a non-negative integer', [Weight], ([weight]) => {
    assert.isTrue(Number.isInteger(weight) && weight >= 0);
  });
});
