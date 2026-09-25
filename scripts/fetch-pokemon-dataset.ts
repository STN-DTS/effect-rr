/**
 * Regenerates the in-memory catalog's dataset (data/pokemon.json) from PokeAPI.
 *
 *   pnpm dataset:fetch            # all Pokémon (~1,300 requests, 8 at a time)
 *   pnpm dataset:fetch -- 50      # only the first 50, e.g. for a quick check
 *
 * It reuses the production http adapter (timeouts, retries, DTO decoding into
 * the domain) and encodes with the same `PokemonDataset` schema the in-memory
 * adapter decodes, so the file is valid by construction.
 */

import { writeFile } from 'node:fs/promises';

import { Effect, Layer, Schema } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientResponse } from 'effect/unstable/http';

import { PokemonCatalog } from '../server/application/index.ts';
import { PokemonName } from '../server/domain/index.ts';
import { EnvConfigProviderLayer } from '../server/infrastructure/index.ts';
import { PokeApiCatalogLayer, PokeApiConfig } from '../server/infrastructure/pokemon-catalog/http/index.ts';
import { PokemonDataset } from '../server/infrastructure/pokemon-catalog/in-memory/index.ts';

const OUTPUT = 'data/pokemon.json';
const CONCURRENCY = 8;
const limitArg = process.argv.slice(2).find((arg) => /^\d+$/.test(arg));
const limit = limitArg === undefined ? 100_000 : Number(limitArg);

const PokemonIndex = Schema.Struct({
  results: Schema.Array(Schema.Struct({ name: Schema.String })),
});

const program = Effect.gen(function* () {
  const { baseUrl } = yield* PokeApiConfig;
  const client = yield* HttpClient.HttpClient;
  const catalog = yield* PokemonCatalog;

  const index = yield* client
    .get(`${baseUrl.href.replace(/\/$/, '')}/pokemon?limit=${limit}`)
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(PokemonIndex)));

  yield* Effect.logInfo(`Fetching ${index.results.length} Pokémon from ${baseUrl.href}`);

  let done = 0;

  const results = yield* Effect.forEach(
    index.results,
    ({ name }) =>
      catalog.findByName(PokemonName.make(name)).pipe(
        Effect.result,
        Effect.tap(() => (++done % 100 === 0 ? Effect.logInfo(`${done}/${index.results.length}`) : Effect.void)),
        Effect.map((result) => ({ name, result })),
      ),
    { concurrency: CONCURRENCY },
  );

  const pokemon = results.flatMap(({ result }) => {
    return result._tag === 'Success' ? [result.success] : [];
  });

  const skipped = results.flatMap(({ name, result }) => {
    return result._tag === 'Failure' ? [`${name}: ${result.failure._tag} ${result.failure.message}`] : [];
  });

  const encoded = yield* Schema.encodeEffect(PokemonDataset)({
    source: `${baseUrl.href.replace(/\/$/, '')}/pokemon`,
    generatedAt: new Date().toISOString(),
    pokemon,
  });

  // One record per line: small diffs when the snapshot is refreshed.
  const body = [
    `{"source":${JSON.stringify(encoded.source)},"generatedAt":${JSON.stringify(encoded.generatedAt)},"pokemon":[`,
    encoded.pokemon.map((record) => JSON.stringify(record)).join(',\n'),
    ']}',
    '',
  ].join('\n');

  yield* Effect.promise(() => writeFile(OUTPUT, body));
  yield* Effect.logInfo(`Wrote ${pokemon.length} Pokémon to ${OUTPUT}`);

  if (skipped.length > 0) {
    yield* Effect.logWarning(`Skipped ${skipped.length} that the domain rejects:\n  ${skipped.join('\n  ')}`);
  }
});

const HttpLayer = FetchHttpClient.layer;

await Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.merge(PokeApiCatalogLayer.pipe(Layer.provide(HttpLayer)), HttpLayer).pipe(
        // Honour POKEAPI_* settings from `.env` too.
        Layer.provideMerge(EnvConfigProviderLayer),
      ),
    ),
  ),
);
