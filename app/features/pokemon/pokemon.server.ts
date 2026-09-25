/**
 * Server half of the Pokémon feature: Effect pipelines + the domain → DTO
 * boundary. Route modules call these and never touch Effect themselves.
 */

import { DateTime, Effect, Schema, SchemaGetter, SchemaTransformation } from 'effect';
import type { RouterContextProvider } from 'react-router';
import { data, href, redirect } from 'react-router';

import type { CatalogUnavailable } from '../../../server/application/index.ts';
import { clearRecentlyViewed, listRecentlyViewed, lookupPokemon } from '../../../server/application/index.ts';
import {
  heightInMetres,
  parsePokemonName,
  Pokemon,
  RecentlyViewedEntry,
  weightInKilograms,
} from '../../../server/domain/index.ts';
import { run } from '../../lib/effect.server.ts';
import type { PokemonDetailDto, RecentlyViewedDto, SearchState } from './dto.ts';

type Context = Readonly<RouterContextProvider>;

// ---------------------------------------------------------------------------
// Domain -> DTO encoding (one-way: DTOs are output-only)
// ---------------------------------------------------------------------------

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

const outputOnly = SchemaGetter.forbidden<never, unknown>(() => 'view DTOs cannot be decoded');

export const PokemonDetailDtoSchema = Schema.Struct({
  name: Schema.String,
  displayName: Schema.String,
  dexNumber: Schema.Number,
  types: Schema.Array(Schema.String),
  heightMetres: Schema.Number,
  weightKilograms: Schema.Number,
  stats: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      label: Schema.String,
      value: Schema.Number,
    }),
  ),
  baseStatTotal: Schema.Number,
  artworkUrl: Schema.NullOr(Schema.String),
});

const PokemonDetailFromDomain = Schema.declare((u): u is Pokemon => u instanceof Pokemon).pipe(
  Schema.encodeTo(
    PokemonDetailDtoSchema,
    SchemaTransformation.makeTransformation({
      decode: outputOnly,
      encode: SchemaGetter.transform((pokemon: Pokemon): typeof PokemonDetailDtoSchema.Type => ({
        name: pokemon.name,
        displayName: displayName(pokemon.name),
        dexNumber: pokemon.dexNumber,
        types: pokemon.types,
        heightMetres: heightInMetres(pokemon.height),
        weightKilograms: weightInKilograms(pokemon.weight),
        stats: pokemon.baseStats.map((s) => ({
          key: s.stat,
          label: STAT_LABELS[s.stat] ?? s.stat,
          value: s.value,
        })),
        baseStatTotal: pokemon.baseStatTotal,
        artworkUrl: pokemon.artworkUrl._tag === 'Some' ? pokemon.artworkUrl.value : null,
      })),
    }),
  ),
);

export const RecentlyViewedDtoSchema = Schema.Struct({
  name: Schema.String,
  displayName: Schema.String,
  dexNumber: Schema.Number,
  viewedAt: Schema.String,
});

const RecentlyViewedFromDomain = Schema.declare((u): u is RecentlyViewedEntry => u instanceof RecentlyViewedEntry).pipe(
  Schema.encodeTo(
    RecentlyViewedDtoSchema,
    SchemaTransformation.makeTransformation({
      decode: outputOnly,
      encode: SchemaGetter.transform((entry: RecentlyViewedEntry): typeof RecentlyViewedDtoSchema.Type => ({
        name: entry.name,
        displayName: displayName(entry.name),
        dexNumber: entry.dexNumber,
        viewedAt: DateTime.formatIso(entry.viewedAt),
      })),
    }),
  ),
);

/** Encoding failures are bugs (the domain is already valid), so they surface as defects. */
export const toPokemonDetailDto: (pokemon: Pokemon) => PokemonDetailDto = Schema.encodeSync(PokemonDetailFromDomain);
export const toRecentlyViewedDtos: (entries: ReadonlyArray<RecentlyViewedEntry>) => ReadonlyArray<RecentlyViewedDto> =
  Schema.encodeSync(Schema.Array(RecentlyViewedFromDomain));

// ---------------------------------------------------------------------------
// Error -> HTTP mapping shared by the routes
// ---------------------------------------------------------------------------

export interface ErrorPayload {
  readonly message: string;
}

const catalogUnavailable = (error: CatalogUnavailable): never => {
  // A payload we cannot understand is a bad gateway; timeouts and outages are "try later".
  throw data<ErrorPayload>(
    { message: 'The Pokédex service is not responding right now. Please try again shortly.' },
    { status: error.reason === 'InvalidResponse' ? 502 : 503 },
  );
};

// ---------------------------------------------------------------------------
// Route pipelines
// ---------------------------------------------------------------------------

/** `GET /pokemon/:name` */
export const loadPokemonDetail = (context: Context, rawName: string) =>
  run(
    context,
    lookupPokemon(rawName).pipe(
      Effect.map((pokemon) => {
        // Serve one canonical URL per Pokémon (/pokemon/Pikachu, /pokemon/25 -> /pokemon/pikachu).
        return pokemon.name === rawName
          ? { pokemon: toPokemonDetailDto(pokemon) }
          : redirect(href('/pokemon/:name', { name: pokemon.name }));
      }),
    ),
    {
      span: 'route.pokemon.loader',
      onError: {
        InvalidPokemonName: (error): never => {
          throw data<ErrorPayload>({ message: error.message }, { status: 400 });
        },
        PokemonNotFound: (error): never => {
          throw data<ErrorPayload>({ message: `There is no Pokémon called “${error.name}”.` }, { status: 404 });
        },
        CatalogUnavailable: catalogUnavailable,
      },
    },
  );

export interface HomeData {
  readonly recentlyViewed: ReadonlyArray<RecentlyViewedDto>;
  readonly search: SearchState;
}

/** `GET /?name=` — renders the home page, or redirects a valid search to its detail page. */
export const loadHome = async (context: Context, query: string | null) => {
  const recentlyViewed = await run(context, listRecentlyViewed().pipe(Effect.map(toRecentlyViewedDtos)), {
    span: 'route.home.recentlyViewed',
    onError: {},
  });

  const page = (search: SearchState): HomeData => ({ recentlyViewed, search });

  if (query === null) {
    return page({ value: '', error: null });
  }

  return run(context, parsePokemonName(query).pipe(Effect.map((name) => redirect(href('/pokemon/:name', { name })))), {
    span: 'route.home.search',
    onError: { InvalidPokemonName: (error) => data(page({ value: query, error: error.message }), 400) },
  });
};

/** `POST /` — `intent=clear` empties the recently-viewed list (Post/Redirect/Get). */
export const homeAction = async (context: Context, form: FormData) => {
  const intent = form.get('intent');

  if (intent !== 'clear') {
    throw data<ErrorPayload>({ message: 'Unsupported action.' }, { status: 400 });
  }

  await run(context, clearRecentlyViewed(), {
    span: 'route.home.clear',
    onError: {},
  });

  return redirect(href('/'));
};
