import { Effect, Layer } from 'effect';

/** Logs runtime construction and disposal (useful to verify graceful shutdown). */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    // Finalizers run after the runtime's context is gone; keep the configured logger for them.
    const context = yield* Effect.context();
    yield* Effect.acquireRelease(Effect.logInfo('application runtime started'), () =>
      Effect.logInfo('application runtime disposed').pipe(Effect.provideContext(context)),
    );
  }),
);
