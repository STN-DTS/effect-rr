import { assert, describe, it } from '@effect/vitest';
import { ConfigProvider, Duration, Effect } from 'effect';

import { defaultSignalUrl, TelemetryConfig } from '../../server/infrastructure/telemetry/index.ts';

const read = (env: Record<string, string>) => TelemetryConfig.parse(ConfigProvider.fromEnvRecord(env));

describe('TelemetryConfig', () => {
  it.effect('defaults to an OTLP/HTTP collector on localhost:4318 with protobuf', () =>
    Effect.gen(function* () {
      const config = yield* read({});
      assert.strictEqual(config.disabled, false);
      assert.strictEqual(config.endpoint.href, 'http://localhost:4318/');
      assert.strictEqual(config.protocol, 'http/protobuf');
      assert.strictEqual(config.serviceName, 'pokedex');
      assert.strictEqual(Duration.toMillis(config.metricsInterval), 10_000);
    }),
  );

  it.effect('reads the standard OTEL_* variables', () =>
    Effect.gen(function* () {
      const config = yield* read({
        OTEL_SDK_DISABLED: 'true',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example.com:4318/otlp',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20abc,x-tenant=pokedex',
        OTEL_SERVICE_NAME: 'pokedex-staging',
        OTEL_METRIC_EXPORT_INTERVAL: '60000',
      });
      assert.strictEqual(config.disabled, true);
      assert.strictEqual(config.protocol, 'http/json');
      assert.deepStrictEqual(config.headers, { 'authorization': 'Bearer abc', 'x-tenant': 'pokedex' });
      assert.strictEqual(config.serviceName, 'pokedex-staging');
      assert.strictEqual(Duration.toMillis(config.metricsInterval), 60_000);
    }),
  );

  it.effect('rejects an unknown protocol', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(read({ OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' }));
      assert.strictEqual(exit._tag, 'Failure');
    }),
  );
});

describe('defaultSignalUrl', () => {
  it('appends /v1/<signal> to the base endpoint', () => {
    assert.strictEqual(defaultSignalUrl(new URL('http://localhost:4318'), 'logs').href, 'http://localhost:4318/v1/logs');
    assert.strictEqual(defaultSignalUrl(new URL('http://localhost:4318/'), 'metrics').href, 'http://localhost:4318/v1/metrics');
  });

  it('keeps a path prefix on the base endpoint', () => {
    assert.strictEqual(
      defaultSignalUrl(new URL('https://gateway.example.com/otlp/'), 'traces').href,
      'https://gateway.example.com/otlp/v1/traces',
    );
  });
});
