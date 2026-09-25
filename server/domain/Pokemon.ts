import { Schema } from 'effect';

import { PokemonName } from './PokemonName.ts';
import { BaseStat, DexNumber, Height, PokemonType, Weight } from './values.ts';

/** The Pokémon aggregate: everything the application knows about one species form. */
export class Pokemon extends Schema.Class<Pokemon>('Pokemon')({
  name: PokemonName,
  dexNumber: DexNumber,
  types: Schema.NonEmptyArray(PokemonType).check(Schema.isMaxLength(2)),
  height: Height,
  weight: Weight,
  baseStats: Schema.Array(BaseStat),
  artworkUrl: Schema.Option(Schema.String),
}) {
  get baseStatTotal(): number {
    return this.baseStats.reduce((total, stat) => total + stat.value, 0);
  }
}
