import { Schema } from 'effect';

/** National Pokédex number. */
export const DexNumber = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 9999 })),
  Schema.brand('DexNumber'),
);
export type DexNumber = typeof DexNumber.Type;

export const POKEMON_TYPES = [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
] as const;
export const PokemonType = Schema.Literals(POKEMON_TYPES);
export type PokemonType = typeof PokemonType.Type;

/** Height in decimetres (the catalog's native unit). */
export const Height = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)), Schema.brand('Height'));
export type Height = typeof Height.Type;
export const heightInMetres = (height: Height): number => height / 10;

/** Weight in hectograms (the catalog's native unit). */
export const Weight = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)), Schema.brand('Weight'));
export type Weight = typeof Weight.Type;
export const weightInKilograms = (weight: Weight): number => weight / 10;

export const STAT_NAMES = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'] as const;
export const StatName = Schema.Literals(STAT_NAMES);
export type StatName = typeof StatName.Type;

export const BaseStatValue = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 255 })),
  Schema.brand('BaseStatValue'),
);
export type BaseStatValue = typeof BaseStatValue.Type;

export class BaseStat extends Schema.Class<BaseStat>('BaseStat')({
  stat: StatName,
  value: BaseStatValue,
}) {}
