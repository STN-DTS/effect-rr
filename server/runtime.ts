import { Duration, Effect, Layer, ManagedRuntime } from 'effect';

import {
  EnvConfigProviderLayer,
  InMemoryRecentlyViewedRepositoryLayer,
  LifecycleLoggingLayer,
  LoggerLayer,
  PokemonCatalogLive,
  ServerConfig,
  TelemetryLayer,
} from './infrastructure/index.ts';

/** Composition root: every port bound to its production adapter. */
export const AppLayer = Layer.mergeAll(PokemonCatalogLive, InMemoryRecentlyViewedRepositoryLayer, LifecycleLoggingLayer).pipe(
  // Provided (not just merged) so layer construction and finalizers are traced and
  // exported too. Built on top of LoggerLayer: the OTLP logger joins the console one.
  Layer.provideMerge(TelemetryLayer),
  // Provided (not just merged) so layer construction and finalizers log through it too.
  Layer.provideMerge(LoggerLayer),
  // Outermost: every Config read (in layers and in effects run on the runtime)
  // sees the environment, then `.env`.
  Layer.provideMerge(EnvConfigProviderLayer),
);

/** Services available to any effect run through the application runtime. */
export type AppServices = Layer.Success<typeof AppLayer>;
export type AppLayerError = Layer.Error<typeof AppLayer>;
export type AppRuntime = ManagedRuntime.ManagedRuntime<AppServices, AppLayerError>;

/**
 * Creates the process-wide runtime. Call exactly once per process (see
 * `server.ts`) and `dispose()` it on shutdown. `layer` is overridable for tests.
 */
export const makeRuntime = (layer: Layer.Layer<AppServices, AppLayerError> = AppLayer): AppRuntime =>
  ManagedRuntime.make(layer);

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
      return {
        host: config.host,
        port: config.port,
        shutdownTimeoutMs: Duration.toMillis(config.shutdownTimeout),
      };
    }),
  );
