import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { Duration, Effect, Layer, Metric, Schema } from 'effect';
import { PokemonCatalog } from '~server/application';
import type { Pokemon, PokemonName } from '~server/domain';
import { PokemonNotFound } from '~server/domain';
import { InMemoryCatalogConfig } from '~server/infrastructure/pokemon-catalog/in-memory/config.ts';
import { PokemonDatasetFromJson } from '~server/infrastructure/pokemon-catalog/in-memory/PokemonRecord.ts';

/** The dataset file is missing or invalid. Fails the layer, so the process refuses to boot. */
export class CatalogDatasetError extends Schema.TaggedError<CatalogDatasetError>()('CatalogDatasetError', {
  path: Schema.String,
  message: Schema.String,
}) {}

/**
 * Builds a catalog over a fixed list. Names resolve exactly; digit-only names
 * resolve by national dex number to the first (default) form, mirroring
 * PokeAPI's `/pokemon/{id}` for default forms.
 */
export const makeInMemoryCatalog = (pokemon: ReadonlyArray<Pokemon>): PokemonCatalog['Service'] => {
  const byName = new Map<string, Pokemon>();
  const byDexNumber = new Map<number, Pokemon>();
  for (const entry of pokemon) {
    byName.set(entry.name, entry);

    if (!byDexNumber.has(entry.dexNumber)) {
      byDexNumber.set(entry.dexNumber, entry);
    }
  }
  return PokemonCatalog.of({
    findByName: (name: PokemonName) => {
      const found = /^\d+$/.test(name) ? byDexNumber.get(Number(name)) : byName.get(name);
      return found ? Effect.succeed(found) : Effect.fail(new PokemonNotFound({ name }));
    },
  });
};

const decodeDataset = Schema.decodeUnknownEffect(PokemonDatasetFromJson);

const datasetEntries = Metric.gauge('pokemon_catalog.dataset.entries', {
  description: 'Pokémon loaded into the in-memory catalog',
  attributes: { unit: '{pokemon}' },
});

/**
 * `PokemonCatalog` served from a JSON snapshot loaded once at startup. It needs
 * no network, never fails with `CatalogUnavailable`, and answers instantly.
 * That makes it the default for local development, demos and tests. The data
 * is only as fresh as the snapshot.
 */
export const layer = Layer.effect(
  PokemonCatalog,
  Effect.gen(function* () {
    const { datasetPath } = yield* InMemoryCatalogConfig;
    const path = resolve(datasetPath);
    yield* Effect.logDebug('reading Pokémon dataset before catalog startup').pipe(
      Effect.annotateLogs({ file: basename(path) }),
    );

    const text = yield* Effect.tryPromise({
      try: () => readFile(path, 'utf8'),
      catch: (cause) => cause,
    }).pipe(
      Effect.tapError((cause) =>
        Effect.logError('Pokémon dataset could not be read; catalog startup cannot continue', cause).pipe(
          Effect.annotateLogs({ file: basename(path) }),
        ),
      ),
      Effect.mapError((cause) => new CatalogDatasetError({ path, message: `cannot read dataset: ${String(cause)}` })),
      Effect.withSpan('InMemoryPokemonCatalog.readDataset', { attributes: { 'file.path': path } }),
    );

    yield* Effect.logDebug('validating Pokémon dataset before serving catalog lookups').pipe(
      Effect.annotateLogs({ file: basename(path), characters: text.length }),
    );

    const [decodeTime, dataset] = yield* decodeDataset(text).pipe(
      Effect.tapError((error) =>
        Effect.logError('Pokémon dataset failed schema validation; catalog startup cannot continue', error).pipe(
          Effect.annotateLogs({ file: basename(path) }),
        ),
      ),
      Effect.mapError((error) => new CatalogDatasetError({ path, message: `invalid dataset: ${error.message}` })),
      Effect.timed,
      Effect.withSpan('InMemoryPokemonCatalog.decodeDataset', { attributes: { 'file.size': text.length } }),
    );

    yield* Metric.update(datasetEntries, dataset.pokemon.length);
    yield* Effect.annotateCurrentSpan({ 'pokemon_catalog.dataset.entries': dataset.pokemon.length });
    yield* Effect.logInfo('in-memory Pokémon catalog loaded').pipe(
      Effect.annotateLogs({
        file: basename(path),
        count: dataset.pokemon.length,
        generatedAt: dataset.generatedAt,
        decodeMs: Math.round(Duration.toMillis(decodeTime)),
      }),
    );
    return makeInMemoryCatalog(dataset.pokemon);
  }).pipe(Effect.withSpan('InMemoryPokemonCatalog.load')),
);
