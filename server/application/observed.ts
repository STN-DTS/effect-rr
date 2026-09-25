/**
 * The one way this codebase measures a unit of work: time it, capture how it
 * ended, hand both to the caller's recorder (metrics, logs, span attributes),
 * then re-raise the outcome untouched. Callers decide only what the outcome
 * *means*; timing, exit capture and duration units live here.
 *
 * Lives in `application` because both the bridge (`app/lib`) and the adapters
 * (`server/infrastructure`) use it, and that is the one layer both may import.
 */

import { Cause, Duration, Effect, Exit } from 'effect';

/** How an effect ended, in the vocabulary every metric's `outcome` label starts from. */
export type ExitKind = 'success' | 'failure' | 'defect' | 'interrupted';

/** What a recorder is told about one finished run. */
export interface Observation<A, E> {
  readonly exit: Exit.Exit<A, E>;
  readonly kind: ExitKind;
  /** The typed failure, when `kind` is `'failure'`. */
  readonly error: E | undefined;
  readonly elapsed: Duration.Duration;
  /** For duration histograms. */
  readonly seconds: number;
  /** 0.1 ms precision, for log attributes and `Server-Timing`. */
  readonly millis: number;
}

/** Milliseconds with 0.1 ms precision, for log attributes and `Server-Timing`. */
export const durationMillis = (duration: Duration.Duration) => Math.round(Duration.toMillis(duration) * 10) / 10;

const exitKind = <A, E>(exit: Exit.Exit<A, E>): ExitKind => {
  if (Exit.isSuccess(exit)) {
    return 'success';
  }

  if (Cause.hasInterruptsOnly(exit.cause)) {
    return 'interrupted';
  }

  return Cause.hasFails(exit.cause) ? 'failure' : 'defect';
};

const typedError = <A, E>(exit: Exit.Exit<A, E>): E | undefined => {
  if (Exit.isSuccess(exit)) {
    return undefined;
  }

  const found = Cause.findError(exit.cause);
  return found._tag === 'Success' ? found.success : undefined;
};

/**
 * Pipeable: runs `effect`, gives `record` its {@link Observation}, then ends
 * exactly as `effect` did. `record` cannot fail: telemetry never changes an
 * outcome. It also runs when the caller is interrupted (e.g. the client went
 * away), which is why only `effect` itself is interruptible.
 */
export const observed =
  <A, E, R2>(record: (observation: Observation<A, E>) => Effect.Effect<void, never, R2>) =>
  <R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | R2> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const [elapsed, exit] = yield* Effect.timed(Effect.exit(restore(effect)));

        yield* record({
          exit,
          kind: exitKind(exit),
          error: typedError(exit),
          elapsed,
          seconds: Duration.toSeconds(elapsed),
          millis: durationMillis(elapsed),
        });

        return yield* exit;
      }),
    );
