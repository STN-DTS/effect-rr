import { Cause, Effect, Exit, Layer, Metric } from 'effect';
import type { CatalogUnavailable, Observation } from '~server/application';
import { observed, PokemonCatalog } from '~server/application';
import type { PokemonName, PokemonNotFound } from '~server/domain';

const requests = Metric.counter('pokemon_catalog.requests', {
  description: 'PokemonCatalog lookups, by adapter and outcome (found, not_found, unavailable, defect, interrupted)',
  incremental: true,
});

const requestDuration = Metric.histogram('pokemon_catalog.request.duration', {
  description: 'PokemonCatalog lookup latency (including retries), by adapter and outcome',
  boundaries: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  attributes: { unit: 's' },
});

type CatalogError = PokemonNotFound | CatalogUnavailable;

type Outcome = 'found' | 'not_found' | 'unavailable' | 'defect' | 'interrupted';

const outcomeOf = ({ kind, error }: Observation<unknown, CatalogError>): Outcome => {
  switch (kind) {
    case 'success': {
      return 'found';
    }
    case 'failure': {
      return error?._tag === 'PokemonNotFound' ? 'not_found' : 'unavailable';
    }
    default: {
      return kind;
    }
  }
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

        return yield* catalog.findByName(name).pipe(
          observed((observation) =>
            Effect.gen(function* () {
              const outcome = outcomeOf(observation);
              const attributes = { 'pokemon_catalog.adapter': adapter, outcome };

              yield* Metric.update(Metric.withAttributes(requests, attributes), 1);
              yield* Metric.update(Metric.withAttributes(requestDuration, attributes), observation.seconds);
              yield* Effect.annotateCurrentSpan({ 'pokemon_catalog.outcome': outcome });

              const log = Effect.annotateLogs({
                'adapter': adapter,
                'pokemon.name': name,
                outcome,
                'durationMs': observation.millis,
              });
              if (outcome === 'unavailable' && Exit.isFailure(observation.exit)) {
                yield* Effect.logWarning('PokemonCatalog lookup failed').pipe(
                  log,
                  Effect.annotateLogs({ error: Cause.squash(observation.exit.cause) }),
                );
              } else {
                yield* Effect.logDebug('PokemonCatalog lookup').pipe(log);
              }
            }),
          ),
        );
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
