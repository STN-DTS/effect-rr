import { Config, Duration } from 'effect';

export const PokeApiConfig = Config.all({
  baseUrl: Config.URL('POKEAPI_BASE_URL').pipe(Config.withDefault(new URL('https://pokeapi.co/api/v2'))),
  /** Per-attempt timeout. */
  timeout: Config.Duration('POKEAPI_TIMEOUT').pipe(Config.withDefault(Duration.seconds(3))),
  /** Retries after the first attempt, for transient failures only. */
  retries: Config.Int('POKEAPI_RETRIES').pipe(Config.withDefault(2)),
});
