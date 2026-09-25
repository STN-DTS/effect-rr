import { Effect, Layer, Metric, Ref } from 'effect';

import { RecentlyViewedRepository } from '../../../application/index.ts';
import { RecentlyViewed } from '../../../domain/index.ts';

const entries = Metric.gauge('recently_viewed.entries', {
  description: 'Entries currently in the recently-viewed list',
  attributes: { unit: '{entry}' },
});

/**
 * Process-local, non-durable implementation. Shared by every request served by
 * this process (one "recently viewed" list per deployment, as specified).
 */
export const InMemoryRecentlyViewedRepositoryLayer = Layer.effect(
  RecentlyViewedRepository,
  Effect.gen(function* () {
    const ref = yield* Ref.make(RecentlyViewed.empty);
    yield* Metric.update(entries, 0);
    return RecentlyViewedRepository.of({
      get: Ref.get(ref).pipe(Effect.withSpan('RecentlyViewedRepository.get')),
      update: (f) =>
        Ref.updateAndGet(ref, f).pipe(
          Effect.flatMap((list) => Metric.update(entries, list.entries.length)),
          Effect.withSpan('RecentlyViewedRepository.update'),
        ),
    });
  }),
);
