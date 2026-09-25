import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { Config, Duration, Effect, Layer, Schema } from 'effect';
import { FetchHttpClient } from 'effect/unstable/http';
import { OtlpLogger, OtlpMetrics, OtlpSerialization, OtlpTracer } from 'effect/unstable/observability';

import packageJson from '../../../package.json' with { type: 'json' };

/** Signal name → the upper-case infix used by the standard `OTEL_*` variables. */
const SIGNALS = { traces: 'TRACES', metrics: 'METRICS', logs: 'LOGS' } as const;
type Signal = keyof typeof SIGNALS;

/**
 * OTLP/HTTP export settings, read from the standard OpenTelemetry variables
 * (a subset of them) so any collector or vendor endpoint can be targeted
 * without code changes.
 */
export const TelemetryConfig = Config.all({
  /** `OTEL_SDK_DISABLED=true` turns every exporter off. */
  disabled: Config.Boolean('OTEL_SDK_DISABLED').pipe(Config.withDefault(false)),
  /** Base URL; each signal is sent to `<endpoint>/v1/<signal>` unless its own endpoint is set. */
  endpoint: Config.URL('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.withDefault(new URL('http://localhost:4318'))),
  protocol: Config.Literals(['http/protobuf', 'http/json'], 'OTEL_EXPORTER_OTLP_PROTOCOL').pipe(
    Config.withDefault('http/protobuf'),
  ),
  /** `key=value,key2=value2` (values URI-encoded), e.g. for collector authentication. */
  headers: Config.Record(Schema.String, Schema.StringFromUriComponent, 'OTEL_EXPORTER_OTLP_HEADERS').pipe(
    Config.withDefault(undefined),
  ),
  serviceName: Config.String('OTEL_SERVICE_NAME').pipe(Config.withDefault('pokedex')),
  serviceVersion: Config.String('OTEL_SERVICE_VERSION').pipe(Config.withDefault(packageJson.version)),
  /** Milliseconds between metric pushes. 10 s (the spec says 60 s) so demo dashboards feel live. */
  metricsInterval: Config.Int('OTEL_METRIC_EXPORT_INTERVAL').pipe(Config.withDefault(10_000), Config.map(Duration.millis)),
});

/** Base endpoint + `v1/<signal>`, keeping any path prefix the base URL has (as the OTLP spec requires). */
export const defaultSignalUrl = (base: URL, signal: Signal) => {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/${signal}`;
  return url;
};

/** `OTEL_<SIGNAL>_EXPORTER=otlp|none` and `OTEL_EXPORTER_OTLP_<SIGNAL>_ENDPOINT` (used as-is). */
const signalConfig = (signal: Signal, base: URL) =>
  Config.all({
    exporter: Config.Literals(['otlp', 'none'], `OTEL_${SIGNALS[signal]}_EXPORTER`).pipe(Config.withDefault('otlp')),
    url: Config.URL(`OTEL_EXPORTER_OTLP_${SIGNALS[signal]}_ENDPOINT`).pipe(Config.withDefault(defaultSignalUrl(base, signal))),
  });

/**
 * Resource attributes that identify this process in every signal. Anything in
 * `OTEL_RESOURCE_ATTRIBUTES` is merged in by the exporter (ours win on conflict).
 */
const resourceAttributes = Effect.gen(function* () {
  const environment = yield* Config.String('NODE_ENV').pipe(Config.withDefault('development'));
  return {
    'service.instance.id': randomUUID(),
    'deployment.environment.name': environment,
    'host.name': hostname(),
    'process.pid': process.pid,
    'process.runtime.name': 'nodejs',
    'process.runtime.version': process.versions.node,
    'telemetry.sdk.name': 'effect',
    'telemetry.sdk.language': 'nodejs',
  };
});

/**
 * Exports traces (spans), metrics and logs over OTLP/HTTP, by default to a
 * collector on `http://localhost:4318`.
 *
 * The OTLP logger is added next to the console logger, so this must be built
 * with `LoggerLayer` already provided.
 *
 * Export is best-effort: an unreachable collector never fails a request or the
 * boot. The exporter drops the batch, logs at debug level and pauses for 60 s.
 * Buffered data is flushed when the runtime is disposed.
 */
export const OtlpExportLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* TelemetryConfig;
    if (config.disabled) {
      yield* Effect.logInfo('telemetry export disabled (OTEL_SDK_DISABLED)');
      return Layer.empty;
    }

    const traces = yield* signalConfig('traces', config.endpoint);
    const metrics = yield* signalConfig('metrics', config.endpoint);
    const logs = yield* signalConfig('logs', config.endpoint);

    const resource = {
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      attributes: yield* resourceAttributes,
    };

    const common = { resource, headers: config.headers };

    yield* Effect.logInfo('telemetry export enabled').pipe(
      Effect.annotateLogs({
        'service.name': config.serviceName,
        'service.version': config.serviceVersion,
        'protocol': config.protocol,
        'traces': traces.exporter === 'otlp' ? traces.url.href : 'none',
        'metrics': metrics.exporter === 'otlp' ? metrics.url.href : 'none',
        'logs': logs.exporter === 'otlp' ? logs.url.href : 'none',
      }),
    );

    return Layer.mergeAll(
      logs.exporter === 'otlp' ? OtlpLogger.layer({ ...common, url: logs.url.href }) : Layer.empty,
      traces.exporter === 'otlp' ? OtlpTracer.layer({ ...common, url: traces.url.href }) : Layer.empty,
      metrics.exporter === 'otlp'
        ? OtlpMetrics.layer({ ...common, url: metrics.url.href, exportInterval: config.metricsInterval })
        : Layer.empty,
    ).pipe(
      Layer.provide(config.protocol === 'http/json' ? OtlpSerialization.layerJson : OtlpSerialization.layerProtobuf),
      Layer.provide(FetchHttpClient.layer),
    );
  }),
);
