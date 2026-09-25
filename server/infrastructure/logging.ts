import { Config, Effect, Layer, Logger, References } from 'effect';

const LOG_LEVELS = ['Trace', 'Debug', 'Info', 'Warn', 'Error', 'Fatal', 'None'] as const;

/**
 * `LOG_FORMAT=json|logfmt|pretty` (default: logfmt) and
 * `LOG_LEVEL=Trace|Debug|Info|Warn|Error|Fatal|None` (default: Info).
 *
 * Besides the console, every log line inside a span is also recorded as an
 * event on that span (`Logger.tracerLogger`), so traces show what happened
 * where. The telemetry layer adds the OTLP logger on top of these.
 */
export const LoggerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const format = yield* Config.Literals(['json', 'logfmt', 'pretty'], 'LOG_FORMAT').pipe(Config.withDefault('logfmt'));
    const level = yield* Config.Literals(LOG_LEVELS, 'LOG_LEVEL').pipe(Config.withDefault('Info'));
    const logger = format === 'json' ? Logger.consoleJson : format === 'pretty' ? Logger.consolePretty() : Logger.consoleLogFmt;
    return Layer.mergeAll(Logger.layer([logger, Logger.tracerLogger]), Layer.succeed(References.MinimumLogLevel, level));
  }),
);

/** Logs runtime construction and disposal (useful to verify graceful shutdown). */
export const LifecycleLoggingLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    // Finalizers run after the runtime's context is gone; keep the configured logger for them.
    const context = yield* Effect.context();
    yield* Effect.acquireRelease(Effect.logInfo('application runtime started'), () =>
      Effect.logInfo('application runtime disposed').pipe(Effect.provideContext(context)),
    );
  }),
);
