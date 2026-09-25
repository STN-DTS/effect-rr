import { Effect, Metric } from 'effect';

import { RecentlyViewedRepository } from '../ports/RecentlyViewedRepository.ts';

const clears = Metric.counter('recently_viewed.clears', {
  description: 'Times the recently-viewed list was cleared',
  incremental: true,
});

export const clearRecentlyViewed = Effect.fn('ClearRecentlyViewed')(function* () {
  const repository = yield* RecentlyViewedRepository;
  const before = yield* repository.get;
  yield* repository.update((list) => list.clear());

  yield* Metric.update(clears, 1);
  yield* Effect.annotateCurrentSpan({ 'recently_viewed.removed': before.entries.length });
  yield* Effect.logInfo('recently viewed cleared').pipe(Effect.annotateLogs({ removed: before.entries.length }));
});
