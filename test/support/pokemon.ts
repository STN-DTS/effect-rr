import { Option } from 'effect';

import {
  BaseStat,
  BaseStatValue,
  DexNumber,
  Height,
  Pokemon,
  PokemonName,
  STAT_NAMES,
  Weight,
} from '../../server/domain/index.ts';
import type { PokemonType } from '../../server/domain/index.ts';

export const makePokemon = (name: string, dex: number, types: readonly [PokemonType, ...PokemonType[]] = ['normal']): Pokemon =>
  new Pokemon({
    name: PokemonName.make(name),
    dexNumber: DexNumber.make(dex),
    types,
    height: Height.make(4),
    weight: Weight.make(60),
    baseStats: STAT_NAMES.map((stat) => new BaseStat({ stat, value: BaseStatValue.make(50) })),
    artworkUrl: Option.some(`https://img.example/${dex}.png`),
  });

export const pikachu = makePokemon('pikachu', 25, ['electric']);
export const bulbasaur = makePokemon('bulbasaur', 1, ['grass', 'poison']);
