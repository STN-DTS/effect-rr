/**
 * The Pokémon view: what the domain looks like to a visitor. It owns the view
 * DTOs (each type is derived from its encoder, so the shape is stated once)
 * and the presentation of every domain error (status, title and message), so
 * route components and error boundaries only render what they are given.
 */

import { DateTime } from 'effect';
import { data } from 'react-router';
import type { ErrorPresentation } from '~app/features/pokemon/dto.ts';
import type { CatalogUnavailable } from '~server/application';
import type { InvalidPokemonName, Pokemon, PokemonNotFound, RecentlyViewedEntry } from '~server/domain';
import { heightInMetres, weightInKilograms } from '~server/domain';

// ---------------------------------------------------------------------------
// Domain -> DTO (one-way: DTOs are output-only, and must survive JSON)
// ---------------------------------------------------------------------------

// The `as` casts widen branded values (PokemonName, DexNumber, ...) to plain
// primitives, so no domain brand leaks into a component's props.

const STAT_LABELS: Record<string, string> = {
  'hp': 'HP',
  'attack': 'Attack',
  'defense': 'Defense',
  'special-attack': 'Sp. Atk',
  'special-defense': 'Sp. Def',
  'speed': 'Speed',
};

export const displayName = (name: string) => {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export const toPokemonDetailDto = (pokemon: Pokemon) => ({
  name: pokemon.name as string,
  displayName: displayName(pokemon.name),
  dexNumber: pokemon.dexNumber as number,
  types: pokemon.types,
  heightMetres: heightInMetres(pokemon.height),
  weightKilograms: weightInKilograms(pokemon.weight),
  stats: pokemon.baseStats.map((s) => ({
    key: s.stat,
    label: STAT_LABELS[s.stat] ?? s.stat,
    value: s.value as number,
  })),
  baseStatTotal: pokemon.baseStatTotal,
  artworkUrl: pokemon.artworkUrl._tag === 'Some' ? pokemon.artworkUrl.value : null,
});

export type PokemonDetailDto = ReturnType<typeof toPokemonDetailDto>;

export const toRecentlyViewedDto = (entry: RecentlyViewedEntry) => ({
  name: entry.name as string,
  displayName: displayName(entry.name),
  dexNumber: entry.dexNumber as number,
  viewedAt: DateTime.formatIso(entry.viewedAt),
});

export type RecentlyViewedDto = ReturnType<typeof toRecentlyViewedDto>;

// ---------------------------------------------------------------------------
// Domain error -> what the visitor sees
// ---------------------------------------------------------------------------

/** Throws the presentation as a route error response, for the route's ErrorBoundary to render. */
const present = (status: number, presentation: ErrorPresentation): never => {
  throw data(presentation, { status });
};

export const invalidName = (error: InvalidPokemonName) => {
  return present(400, { title: 'Invalid name', message: error.message });
};

export const pokemonNotFound = (error: PokemonNotFound) => {
  return present(404, { title: 'Pokémon not found', message: `There is no Pokémon called “${error.name}”.` });
};

export const catalogUnavailable = (error: CatalogUnavailable) => {
  // A payload we cannot understand is a bad gateway; timeouts and outages are "try later".
  return present(error.reason === 'InvalidResponse' ? 502 : 503, {
    title: 'Pokédex unavailable',
    message: 'The Pokédex service is not responding right now. Please try again shortly.',
  });
};

export const unsupportedAction = () => {
  return present(400, { title: 'Unsupported action', message: 'Unsupported action.' });
};
