import { makeAppLayer, makeRuntime } from '../../server/runtime.ts';

/**
 * Hermetic configuration for the real application: no `.env` file, no
 * telemetry export, no console logs, and the in-memory catalog over a small
 * fixture dataset (bulbasaur, charizard, pikachu, mr-mime, deoxys-normal,
 * deoxys-attack).
 */
export const TEST_ENV = {
  DOTENV_PATH: '',
  OTEL_SDK_DISABLED: 'true',
  LOG_LEVEL: 'None',
  POKEMON_DATASET_PATH: 'test/fixtures/dataset/pokemon.json',
};

/** The http catalog pointed at an address nothing listens on: every lookup is `CatalogUnavailable`. */
export const UNAVAILABLE_CATALOG = {
  POKEMON_CATALOG: 'http',
  POKEAPI_BASE_URL: 'http://127.0.0.1:9/api/v2',
  POKEAPI_RETRIES: '0',
};

type Env = Record<string, string>;

/** The production composition root, configured with {@link TEST_ENV} plus `env`. */
export const testAppLayer = (env: Env = {}) => makeAppLayer({ ...TEST_ENV, ...env });

/** A runtime over {@link testAppLayer}, as `server.ts` would build it. */
export const makeTestRuntime = (env: Env = {}) => makeRuntime({ ...TEST_ENV, ...env });
