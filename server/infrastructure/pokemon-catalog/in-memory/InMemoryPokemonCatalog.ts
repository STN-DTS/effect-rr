import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Duration, Effect, Layer, Metric, Schema } from 'effect';

import { PokemonCatalog } from '../../../application/index.ts';
import type { Pokemon, PokemonName } from '../../../domain/index.ts';
import { PokemonNotFound } from '../../../domain/index.ts';
import { InMemoryCatalogConfig } from './config.ts';
import { PokemonDatasetFromJson } from './PokemonRecord.ts';

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
export const InMemoryPokemonCatalogLayer = Layer.effect(
  PokemonCatalog,
  Effect.gen(function* () {
    const { datasetPath } = yield* InMemoryCatalogConfig;
    const path = resolve(datasetPath);

    const text = yield* Effect.tryPromise({
      try: () => readFile(path, 'utf8'),
      catch: (cause) => new CatalogDatasetError({ path, message: `cannot read dataset: ${String(cause)}` }),
    }).pipe(Effect.withSpan('InMemoryPokemonCatalog.readDataset', { attributes: { 'file.path': path } }));
    const [decodeTime, dataset] = yield* decodeDataset(text).pipe(
      Effect.mapError((error) => new CatalogDatasetError({ path, message: `invalid dataset: ${error.message}` })),
      Effect.timed,
      Effect.withSpan('InMemoryPokemonCatalog.decodeDataset', { attributes: { 'file.size': text.length } }),
    );

    yield* Metric.update(datasetEntries, dataset.pokemon.length);
    yield* Effect.annotateCurrentSpan({ 'pokemon_catalog.dataset.entries': dataset.pokemon.length });
    yield* Effect.logInfo('in-memory Pokémon catalog loaded').pipe(
      Effect.annotateLogs({
        path,
        count: dataset.pokemon.length,
        generatedAt: dataset.generatedAt,
        decodeMs: Math.round(Duration.toMillis(decodeTime)),
      }),
    );
    return makeInMemoryCatalog(dataset.pokemon);
  }).pipe(
    Effect.tapError((error) => Effect.logError('in-memory Pokémon catalog failed to load', error)),
    Effect.withSpan('InMemoryPokemonCatalog.load'),
  ),
);
