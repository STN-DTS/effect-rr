import type { Effect } from 'effect';
import { Context } from 'effect';
import type { RecentlyViewed } from '~server/domain';

/** Outbound port: persistence for the "recently viewed" aggregate. */
export class RecentlyViewedRepository extends Context.Service<
  RecentlyViewedRepository,
  {
    readonly get: Effect.Effect<RecentlyViewed>;
    /** Atomically replaces the aggregate with `f(current)`. */
    readonly update: (f: (current: RecentlyViewed) => RecentlyViewed) => Effect.Effect<void>;
  }
>()('app/application/RecentlyViewedRepository') {}
