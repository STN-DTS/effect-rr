import { Duration, Effect, Layer, ManagedRuntime } from 'effect';
import {
  EnvConfig,
  InMemoryRecentlyViewedRepository,
  LifecycleLogging,
  Logging,
  PokemonCatalogAdapter,
  ServerConfig,
  Telemetry,
} from '~server/infrastructure';

type Env = Record<string, string | undefined>;

/**
 * Composition root: every port bound to its production adapter, configured
 * from `env` (then the `.env` file it points to). Configuration is the only
 * thing that varies between production and tests.
 */
export const makeAppLayer = (env: Env) =>
  Layer.mergeAll(PokemonCatalogAdapter.layer, InMemoryRecentlyViewedRepository.layer, LifecycleLogging.layer).pipe(
    // Provided (not just merged) so layer construction and finalizers are traced and
    // exported too. Built on top of Logging.layer: the OTLP logger joins the console one.
    Layer.provideMerge(Telemetry.layer),
    // Provided (not just merged) so layer construction and finalizers log through it too.
    Layer.provideMerge(Logging.layer),
    // Outermost: every Config read (in layers and in effects run on the runtime)
    // sees the environment, then `.env`.
    Layer.provideMerge(EnvConfig.layer(env)),
  );

type AppLayer = ReturnType<typeof makeAppLayer>;

/** Services available to any effect run through the application runtime. */
export type AppServices = Layer.Success<AppLayer>;
export type AppLayerError = Layer.Error<AppLayer>;
export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, AppLayerError>;

/**
 * Creates the process-wide runtime. Call exactly once per process (see
 * `server.ts`) and `dispose()` it on shutdown. Tests pass their own `env`.
 */
export const makeRuntime = (env: Env = process.env): AppRuntime => {
  return ManagedRuntime.make(makeAppLayer(env));
};

export interface ServerSettings {
  readonly host: string;
  readonly port: number;
  readonly shutdownTimeoutMs: number;
}

/** Reads the process-level settings through Effect `Config`, as plain values. */
export const loadServerConfig = (runtime: AppRuntime): Promise<ServerSettings> =>
  runtime.runPromise(
    Effect.gen(function* () {
      const config = yield* ServerConfig;

      yield* Effect.logDebug('server settings loaded; listener and graceful shutdown will use configured values').pipe(
        Effect.annotateLogs({
          host: config.host,
          port: config.port,
          shutdownTimeoutMs: Duration.toMillis(config.shutdownTimeout),
        }),
      );

      return {
        host: config.host,
        port: config.port,
        shutdownTimeoutMs: Duration.toMillis(config.shutdownTimeout),
      };
    }).pipe(
      Effect.tapError((error) =>
        Effect.logError('server settings could not be loaded; listener startup cannot continue', error),
      ),
    ),
  );
