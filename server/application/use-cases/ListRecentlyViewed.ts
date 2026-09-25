import { Effect } from 'effect';

import { RecentlyViewedRepository } from '../ports/RecentlyViewedRepository.ts';

/** Most recent first, deduplicated, bounded (see the `RecentlyViewed` aggregate). */
export const listRecentlyViewed = Effect.fn('ListRecentlyViewed')(function* () {
  const repository = yield* RecentlyViewedRepository;
  const list = yield* repository.get;
  yield* Effect.annotateCurrentSpan({ 'recently_viewed.entries': list.entries.length });
  return list.entries;
});
