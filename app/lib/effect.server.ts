/**
 * The bridge between React Router (HTTP/UI adapter) and Effect (application
 * core): `run()` enters the request scope (`request.server.ts`) and turns an
 * Effect program's outcome into a loader/action result. Apart from
 * `request.server.ts` and per-feature `*.server.ts` pipelines, this is the only
 * module under `app/` allowed to import `effect`.
 */

import { Cause, Duration, Effect, Exit, Metric } from 'effect';
import type { data, RouterContextProvider } from 'react-router';

import { CurrentRequest } from '../../server/application/index.ts';
import type { AppServices } from '../../server/runtime.ts';
import { requestScope } from './request.server.ts';

// ---------------------------------------------------------------------------
// run(): executes one Effect program for a loader/action
// ---------------------------------------------------------------------------

/** What an error handler may produce: `data(..., { status })`, `redirect(...)`, or a thrown Response. */
export type RouteErrorResult = ReturnType<typeof data> | Response;

type Tagged = { readonly _tag: string };

/** One handler per failure tag, so forgetting to map an error is a type error. */
export type ErrorHandlers<E extends Tagged> = {
  readonly [K in E['_tag']]: (error: Extract<E, { readonly _tag: K }>) => RouteErrorResult;
};

export interface RunOptions<E extends Tagged, H extends ErrorHandlers<E>> {
  /** Name of the tracing span wrapping the effect; also the `effect.name` metric attribute. */
  readonly span: string;
  readonly onError: H;
}

const effectRuns = Metric.counter('app.effect.runs', {
  description: 'Effect programs run by loaders/actions, by name and outcome (success, failure, defect, interrupted)',
  incremental: true,
});

const effectDuration = Metric.histogram('app.effect.duration', {
  description: 'Duration of Effect programs run by loaders/actions, by name and outcome',
  boundaries: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  attributes: { unit: 's' },
});

/** Milliseconds with 0.1 ms precision, for log attributes. */
const roundMillis = (duration: Duration.Duration) => Math.round(Duration.toMillis(duration) * 10) / 10;

type RunOutcome = 'success' | 'failure' | 'defect' | 'interrupted';

const runOutcome = <A, E>(exit: Exit.Exit<A, E>): RunOutcome => {
  if (Exit.isSuccess(exit)) {
    return 'success';
  }

  if (Cause.hasInterruptsOnly(exit.cause)) {
    return 'interrupted';
  }

  return Cause.hasFails(exit.cause) ? 'failure' : 'defect';
};

/** Metrics and logs for one `run()`: expected failures quietly, defects loudly. */
const observeRun = <A, E extends Tagged>(name: string, elapsed: Duration.Duration, exit: Exit.Exit<A, E>) =>
  Effect.gen(function* () {
    const outcome = runOutcome(exit);
    const failure = Exit.isFailure(exit) ? Cause.findError(exit.cause) : undefined;
    const errorType = failure?._tag === 'Success' ? failure.success._tag : undefined;
    const attributes = { 'effect.name': name, outcome, ...(errorType ? { 'error.type': errorType } : {}) };

    yield* Metric.update(Metric.withAttributes(effectRuns, attributes), 1);
    yield* Metric.update(Metric.withAttributes(effectDuration, attributes), Duration.toSeconds(elapsed));

    const log = Effect.annotateLogs({ ...attributes, durationMs: roundMillis(elapsed) });

    if (outcome === 'failure') {
      yield* Effect.logDebug('effect failed with a handled error').pipe(log);
    } else if (outcome === 'defect' && Exit.isFailure(exit)) {
      yield* Effect.logError('effect died (defect): responding 500', exit.cause).pipe(log);
    } else if (outcome === 'interrupted') {
      yield* Effect.logInfo('effect interrupted (client went away)').pipe(log);
    } else {
      yield* Effect.logDebug('effect succeeded').pipe(log);
    }
  });

/**
 * Runs `effect` on the app runtime with request-scoped services provided.
 *
 * - success values are returned as-is (they must already be plain DTOs);
 * - typed failures are passed to the matching `onError` handler, whose
 *   result is returned (or which throws a Response);
 * - defects and interruptions reject, surfacing as 500s in the ErrorBoundary.
 *
 * The effect runs in a span named `options.span`, a child of the calling
 * loader/action's span (or of the request's server span), and every run is
 * counted, timed and logged by outcome.
 */
export async function run<A, E extends Tagged, H extends ErrorHandlers<E>>(
  context: Readonly<RouterContextProvider>,
  effect: Effect.Effect<A, E, AppServices | CurrentRequest>,
  options: RunOptions<E, H>,
): Promise<A | ReturnType<H[keyof H]>> {
  const scope = requestScope(context);

  const exit = await scope.runtime.runPromise(
    Effect.gen(function* () {
      const [elapsed, result] = yield* Effect.timed(Effect.exit(effect));
      yield* observeRun(options.span, elapsed, result);
      return yield* result;
    }).pipe(
      Effect.withSpan(options.span, {
        parent: scope.parentSpan,
        attributes: { 'request.id': scope.id },
      }),
      Effect.provideService(CurrentRequest, CurrentRequest.of({ requestId: scope.id })),
      Effect.annotateLogs({ requestId: scope.id }),
      Effect.exit,
    ),
    { signal: scope.signal },
  );

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  const failure = Cause.findError(exit.cause);
  if (failure._tag === 'Failure') {
    // Defect or interruption: reject with the underlying error, as runPromise would.
    throw Cause.squash(exit.cause);
  }

  const error = failure.success;

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- lookup by runtime tag; exhaustiveness is enforced by ErrorHandlers<E>
  const handler = options.onError[error._tag as keyof H] as ((error: E) => ReturnType<H[keyof H]>) | undefined;

  if (handler === undefined) {
    // Only reachable if the type-level exhaustiveness check was bypassed: treat as a defect (500).
    throw new Error(`Unhandled failure "${error._tag}" in ${options.span}`, { cause: error });
  }

  return handler(error);
}
