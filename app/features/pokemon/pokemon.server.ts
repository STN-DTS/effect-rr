/**
 * Server half of the Pokémon feature: the Effect pipelines behind each route.
 * What their results and errors look like is `view.server.ts`'s job. Route
 * modules call these and never touch Effect themselves.
 */

import { Effect } from 'effect';
import type { RouterContextProvider } from 'react-router';
import { data, href, redirect } from 'react-router';
import type { SearchState } from '~app/features/pokemon/dto.ts';
import type { RecentlyViewedDto } from '~app/features/pokemon/view.server.ts';
import {
  catalogUnavailable,
  invalidName,
  pokemonNotFound,
  toPokemonDetailDto,
  toRecentlyViewedDto,
  unsupportedAction,
} from '~app/features/pokemon/view.server.ts';
import { run } from '~app/lib/effect.server.ts';
import { clearRecentlyViewed, listRecentlyViewed, lookupPokemon } from '~server/application';
import { parsePokemonName } from '~server/domain';

type Context = Readonly<RouterContextProvider>;

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
        InvalidPokemonName: invalidName,
        PokemonNotFound: pokemonNotFound,
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
  const recentlyViewed = await run(
    context,
    listRecentlyViewed().pipe(Effect.map((entries) => entries.map(toRecentlyViewedDto))),
    {
      span: 'route.home.recentlyViewed',
      onError: {},
    },
  );

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
    return unsupportedAction();
  }

  await run(context, clearRecentlyViewed(), {
    span: 'route.home.clear',
    onError: {},
  });

  return redirect(href('/'));
};
