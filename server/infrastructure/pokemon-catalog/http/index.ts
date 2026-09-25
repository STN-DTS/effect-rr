import { Layer } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';

import { PokeApiCatalogLayer } from './PokeApiCatalog.ts';

export { PokeApiConfig } from './config.ts';
export { PokeApiCatalogLayer } from './PokeApiCatalog.ts';
export { PokeApiPokemon, toPokemonInput } from './PokeApiDto.ts';

/** `PokemonCatalog` backed by PokeAPI over HTTP, wired to the platform `fetch`. */
export const HttpPokemonCatalogLive = PokeApiCatalogLayer.pipe(Layer.provide(FetchHttpClient.layer));
