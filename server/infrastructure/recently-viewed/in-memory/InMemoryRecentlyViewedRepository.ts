import { Effect, Layer, Metric, Ref } from 'effect';
import { RecentlyViewedRepository } from '~server/application';
import { RecentlyViewed } from '~server/domain';

const entries = Metric.gauge('recently_viewed.entries', {
  description: 'Entries currently in the recently-viewed list',
  attributes: { unit: '{entry}' },
});

/**
 * Process-local, non-durable implementation. Shared by every request served by
 * this process (one "recently viewed" list per deployment, as specified).
 */
export const layer = Layer.effect(
  RecentlyViewedRepository,
  Effect.gen(function* () {
    const ref = yield* Ref.make(RecentlyViewed.empty);
    yield* Metric.update(entries, 0);
    return RecentlyViewedRepository.of({
      get: Effect.gen(function* () {
        const list = yield* Ref.get(ref);
        yield* Effect.logDebug('recently viewed state loaded for the current query').pipe(
          Effect.annotateLogs({ entries: list.entries.length }),
        );
        return list;
      }).pipe(Effect.withSpan('RecentlyViewedRepository.get')),
      update: (f) =>
        Ref.updateAndGet(ref, f).pipe(
          Effect.tap((list) =>
            Effect.logDebug('recently viewed state updated; the new entry count is available').pipe(
              Effect.annotateLogs({ entries: list.entries.length }),
            ),
          ),
          Effect.flatMap((list) => Metric.update(entries, list.entries.length)),
          Effect.withSpan('RecentlyViewedRepository.update'),
        ),
    });
  }),
);
