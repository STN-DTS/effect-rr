import { Config } from 'effect';

export const InMemoryCatalogConfig = Config.all({
  /** Dataset file, relative to the working directory. Regenerate with `pnpm dataset:fetch`. */
  datasetPath: Config.String('POKEMON_DATASET_PATH').pipe(Config.withDefault('data/pokemon.json')),
});
