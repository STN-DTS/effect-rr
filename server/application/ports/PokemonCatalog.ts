import { Context, Schema } from 'effect';
import type { Effect } from 'effect';

import type { Pokemon, PokemonName, PokemonNotFound } from '../../domain/index.ts';

/**
 * The catalog could not answer. Adapters must translate every transport,
 * status and decoding problem into this error; nothing adapter-specific leaks.
 */
export class CatalogUnavailable extends Schema.TaggedError<CatalogUnavailable>()('CatalogUnavailable', {
  reason: Schema.Literals(['Timeout', 'UpstreamFailure', 'InvalidResponse']),
  message: Schema.String,
}) {}

/** Outbound port: read-only access to the national Pokémon catalog. */
export class PokemonCatalog extends Context.Service<
  PokemonCatalog,
  {
    readonly findByName: (name: PokemonName) => Effect.Effect<Pokemon, PokemonNotFound | CatalogUnavailable>;
  }
>()('app/application/PokemonCatalog') {}
