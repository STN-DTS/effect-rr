import { Cause, Duration, Effect, Exit, Layer, Metric } from 'effect';

import { PokemonCatalog } from '../../application/index.ts';
import type { PokemonName } from '../../domain/index.ts';

const requests = Metric.counter('pokemon_catalog.requests', {
  description: 'PokemonCatalog lookups, by adapter and outcome (found, not_found, unavailable, defect, interrupted)',
  incremental: true,
});

const requestDuration = Metric.histogram('pokemon_catalog.request.duration', {
  description: 'PokemonCatalog lookup latency (including retries), by adapter and outcome',
  boundaries: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  attributes: { unit: 's' },
});

/** Milliseconds with 0.1 ms precision, for log attributes. */
const roundMillis = (duration: Duration.Duration) => Math.round(Duration.toMillis(duration) * 10) / 10;

type Outcome = 'found' | 'not_found' | 'unavailable' | 'defect' | 'interrupted';

const outcomeOf = <A, E extends { readonly _tag: string }>(exit: Exit.Exit<A, E>): Outcome => {
  if (Exit.isSuccess(exit)) {
    return 'found';
  }

  if (Cause.hasInterruptsOnly(exit.cause)) {
    return 'interrupted';
  }

  const error = Cause.findError(exit.cause);

  if (error._tag === 'Failure') {
    return 'defect';
  }

  return error.success._tag === 'PokemonNotFound' ? 'not_found' : 'unavailable';
};

/**
 * Decorates any `PokemonCatalog` with a span, RED metrics and logs, labelled
 * with the adapter name. Adapters stay free of cross-cutting code, and every
 * adapter (present or future) is measured identically, so their latencies
 * can be compared on one dashboard panel.
 */
export const instrumentCatalog =
  (adapter: string) =>
  (catalog: PokemonCatalog['Service']): PokemonCatalog['Service'] =>
    PokemonCatalog.of({
      findByName: Effect.fn('PokemonCatalog.findByName')(function* (name: PokemonName) {
        yield* Effect.annotateCurrentSpan({ 'pokemon_catalog.adapter': adapter, 'pokemon.name': name });

        const [elapsed, exit] = yield* Effect.timed(Effect.exit(catalog.findByName(name)));
        const outcome = outcomeOf(exit);
        const attributes = { 'pokemon_catalog.adapter': adapter, outcome };

        yield* Metric.update(Metric.withAttributes(requests, attributes), 1);
        yield* Metric.update(Metric.withAttributes(requestDuration, attributes), Duration.toSeconds(elapsed));
        yield* Effect.annotateCurrentSpan({ 'pokemon_catalog.outcome': outcome });

        const log = Effect.annotateLogs({
          'adapter': adapter,
          'pokemon.name': name,
          outcome,
          'durationMs': roundMillis(elapsed),
        });
        if (outcome === 'unavailable' && Exit.isFailure(exit)) {
          yield* Effect.logWarning('PokemonCatalog lookup failed').pipe(
            log,
            Effect.annotateLogs({ error: Cause.squash(exit.cause) }),
          );
        } else {
          yield* Effect.logDebug('PokemonCatalog lookup').pipe(log);
        }

        return yield* exit;
      }),
    });

/**
 * Pipeable: `SomeCatalogLayer.pipe(instrumented('name'))` wraps the
 * `PokemonCatalog` it provides with {@link instrumentCatalog}.
 */
export const instrumented =
  (adapter: string) =>
  <E, R>(layer: Layer.Layer<PokemonCatalog, E, R>): Layer.Layer<PokemonCatalog, E, R> =>
    Layer.effect(
      PokemonCatalog,
      Effect.gen(function* () {
        return instrumentCatalog(adapter)(yield* PokemonCatalog);
      }),
    ).pipe(Layer.provide(layer));
