import { assert, describe, it } from '@effect/vitest';
import { Data, Duration, Effect, Exit, Fiber } from 'effect';
import type { ExitKind, Observation } from '~server/application';
import { durationMillis, observed } from '~server/application';

class Boom extends Data.TaggedError('Boom')<{}> {}

/** Runs `effect` through `observed`, returning what the recorder saw and how the run ended. */
const observe = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    let seen: Observation<A, E> | undefined;

    const exit = yield* effect.pipe(
      observed((observation) => Effect.sync(() => void (seen = observation))),
      Effect.exit,
    );

    assert.isDefined(seen);
    return { seen, exit };
  });

describe('observed', () => {
  it.effect.each<[string, Effect.Effect<number, Boom>, ExitKind, string | undefined]>([
    ['success', Effect.succeed(1), 'success', undefined],
    ['failure', Effect.fail(new Boom()), 'failure', 'Boom'],
    ['defect', Effect.die('bug'), 'defect', undefined],
  ])('classifies a %s and re-raises it unchanged', ([, effect, kind, tag]) =>
    Effect.gen(function* () {
      const { seen, exit } = yield* observe(effect);

      assert.strictEqual(seen.kind, kind);
      assert.strictEqual(seen.error?._tag, tag);
      assert.deepStrictEqual(exit, seen.exit);
    }),
  );

  it.effect('classifies an interruption', () =>
    Effect.gen(function* () {
      let kind: ExitKind | undefined;

      const fiber = yield* Effect.never.pipe(
        observed((observation) => Effect.sync(() => void (kind = observation.kind))),
        Effect.forkChild,
      );

      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      assert.strictEqual(kind, 'interrupted');
    }),
  );

  it.effect('reports the duration in seconds and rounded milliseconds', () =>
    Effect.gen(function* () {
      const { seen } = yield* observe(Effect.succeed(1));

      assert.isTrue(Exit.isSuccess(seen.exit));
      assert.isAtLeast(seen.seconds, 0);
      assert.strictEqual(seen.millis, durationMillis(seen.elapsed));
    }),
  );

  it('rounds milliseconds to 0.1 ms', () => {
    assert.strictEqual(durationMillis(Duration.nanos(1_234_567n)), 1.2);
  });
});
