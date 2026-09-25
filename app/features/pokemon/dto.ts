/**
 * Plain, serializable view models: the only shapes that reach components.
 * No Effect, no branded types, no classes.
 */

export interface PokemonStatDto {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

export interface PokemonDetailDto {
  readonly name: string;
  readonly displayName: string;
  readonly dexNumber: number;
  readonly types: ReadonlyArray<string>;
  readonly heightMetres: number;
  readonly weightKilograms: number;
  readonly stats: ReadonlyArray<PokemonStatDto>;
  readonly baseStatTotal: number;
  readonly artworkUrl: string | null;
}

export interface RecentlyViewedDto {
  readonly name: string;
  readonly displayName: string;
  readonly dexNumber: number;
  readonly viewedAt: string;
}

export interface SearchState {
  readonly value: string;
  readonly error: string | null;
}

export const formatDexNumber = (dexNumber: number) => {
  return `#${String(dexNumber).padStart(4, '0')}`;
};
