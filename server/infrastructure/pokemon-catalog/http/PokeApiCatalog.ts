import { Duration, Effect, Layer, Metric, Schedule, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/unstable/http';

import { CatalogUnavailable, PokemonCatalog } from '../../../application/index.ts';
import type { PokemonName } from '../../../domain/index.ts';
import { Pokemon, PokemonNotFound } from '../../../domain/index.ts';
import { PokeApiConfig } from './config.ts';
import { PokeApiPokemon, toPokemonInput } from './PokeApiDto.ts';

/** Internal: a failure worth retrying. Never leaves this module. */
class TransientFailure extends Schema.TaggedError<TransientFailure>()('TransientFailure', {
  reason: Schema.Literals(['Timeout', 'UpstreamFailure']),
  message: Schema.String,
}) {}

// --- Metrics ------------------------------------------------------------------

/** Per attempt, so retries show up as separate observations. Only attempts that got a response. */
const requestDuration = Metric.histogram('pokeapi.request.duration', {
  description: 'PokeAPI response time per attempt, by HTTP status code',
  boundaries: [0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5],
  attributes: { unit: 's' },
});

const attempts = Metric.counter('pokeapi.attempts', {
  description: 'PokeAPI attempts, by outcome (success, not_found, timeout, upstream_failure, client_error, invalid_body)',
  incremental: true,
});

const retries = Metric.counter('pokeapi.retries', {
  description: 'PokeAPI retries (attempts after the first), by the reason of the failure that caused them',
  incremental: true,
});

const contractViolations = Metric.counter('pokeapi.contract_violations', {
  description: 'PokeAPI payloads rejected by our schemas, by stage (payload, domain)',
  incremental: true,
});

const count = (metric: Metric.Metric<number, unknown>, attributes: Record<string, string>) =>
  Metric.update(Metric.withAttributes(metric, attributes), 1);

// --- Adapter ------------------------------------------------------------------

const isTransientStatus = (status: number) => status === 429 || status >= 500;

const decodePayload = Schema.decodeUnknownEffect(PokeApiPokemon);
const decodePokemon = Schema.decodeUnknownEffect(Pokemon);

const invalidResponse = (message: string) => new CatalogUnavailable({ reason: 'InvalidResponse', message });

const attemptOutcome = (error: PokemonNotFound | TransientFailure | CatalogUnavailable) => {
  if (error._tag === 'PokemonNotFound') {
    return 'not_found';
  }

  if (error._tag === 'TransientFailure') {
    return error.reason === 'Timeout' ? 'timeout' : 'upstream_failure';
  }

  return error.reason === 'InvalidResponse' ? 'invalid_body' : 'client_error';
};

/**
 * `PokemonCatalog` adapter backed by the public PokeAPI (or any server that
 * speaks its `/pokemon/{name}` contract, e.g. the e2e stub).
 *
 * - each attempt has its own timeout;
 * - only transient failures (network errors, timeouts, 429/5xx) are retried,
 *   with jittered exponential backoff;
 * - 404 becomes the domain error `PokemonNotFound`;
 * - everything else becomes `CatalogUnavailable`. That includes malformed
 *   payloads (`reason: "InvalidResponse"`): an upstream contract break is a
 *   bad-gateway condition for callers, not a bug in our code, so it must be
 *   renderable as a 502 rather than crash the request as a defect.
 *
 * Observability: `HttpClient` traces every request (with W3C trace context
 * propagated to PokeAPI). On top of that, each attempt is its own span and is
 * counted and timed; retries, give-ups and contract violations are counted
 * and logged.
 */
export const PokeApiCatalogLayer = Layer.effect(
  PokemonCatalog,
  Effect.gen(function* () {
    const config = yield* PokeApiConfig;
    const baseUrl = config.baseUrl.href.replace(/\/$/, '');
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest((request) => request.pipe(HttpClientRequest.prependUrl(baseUrl), HttpClientRequest.acceptJson)),
    );

    yield* Effect.logInfo('PokeAPI adapter configured').pipe(
      Effect.annotateLogs({
        baseUrl,
        timeout: Duration.format(config.timeout),
        retries: config.retries,
      }),
    );

    const attempt = (name: PokemonName, attemptNumber: number) =>
      Effect.gen(function* () {
        const [elapsed, response] = yield* Effect.timed(client.get(`/pokemon/${encodeURIComponent(name)}`));
        yield* Metric.update(
          Metric.withAttributes(requestDuration, { 'http.response.status_code': String(response.status) }),
          Duration.toSeconds(elapsed),
        );
        yield* Effect.annotateCurrentSpan({ 'http.response.status_code': response.status });

        if (response.status === 404) {
          return yield* new PokemonNotFound({ name });
        }
        if (isTransientStatus(response.status)) {
          return yield* new TransientFailure({
            reason: 'UpstreamFailure',
            message: `PokeAPI responded ${response.status}`,
          });
        }
        if (response.status < 200 || response.status >= 300) {
          return yield* new CatalogUnavailable({
            reason: 'UpstreamFailure',
            message: `PokeAPI responded ${response.status}`,
          });
        }
        return yield* response.json.pipe(Effect.mapError(() => invalidResponse('PokeAPI returned a non-JSON body')));
      }).pipe(
        Effect.timeoutOrElse({
          duration: config.timeout,
          orElse: () =>
            Effect.fail(
              new TransientFailure({
                reason: 'Timeout',
                message: `PokeAPI did not answer within ${Duration.format(config.timeout)}`,
              }),
            ),
        }),
        Effect.catchTag('HttpClientError', (error) =>
          Effect.fail(new TransientFailure({ reason: 'UpstreamFailure', message: error.message })),
        ),
        Effect.tap(() => count(attempts, { outcome: 'success' })),
        Effect.tapError((error) =>
          Effect.gen(function* () {
            yield* count(attempts, { outcome: attemptOutcome(error) });

            if (error._tag !== 'TransientFailure') {
              return;
            }

            const willRetry = attemptNumber <= config.retries;

            if (willRetry) {
              yield* count(retries, { reason: error.reason });
            }

            yield* Effect.logWarning('PokeAPI attempt failed').pipe(
              Effect.annotateLogs({
                'pokemon.name': name,
                'attempt': attemptNumber,
                'reason': error.reason,
                'error': error.message,
                willRetry,
              }),
            );
          }),
        ),
        Effect.withSpan('PokeApiCatalog.attempt', {
          attributes: { 'pokemon.name': name, 'pokeapi.attempt': attemptNumber },
        }),
      );

    const retryPolicy = Schedule.exponential('100 millis').pipe(Schedule.jittered);

    const findByName = Effect.fn('PokeApiCatalog.findByName')(function* (name: PokemonName) {
      yield* Effect.annotateCurrentSpan({ 'pokemon.name': name, 'pokeapi.base_url': baseUrl });
      let attemptNumber = 0;
      const body = yield* Effect.suspend(() => attempt(name, ++attemptNumber)).pipe(
        Effect.retry({
          schedule: retryPolicy,
          times: config.retries,
          while: (error) => error._tag === 'TransientFailure',
        }),
        Effect.catchTag('TransientFailure', (error) =>
          Effect.gen(function* () {
            yield* Effect.logError('PokeAPI unavailable after retries').pipe(
              Effect.annotateLogs({
                'pokemon.name': name,
                'attempts': attemptNumber,
                'reason': error.reason,
                'error': error.message,
              }),
            );
            return yield* new CatalogUnavailable({ reason: error.reason, message: error.message });
          }),
        ),
      );
      yield* Effect.annotateCurrentSpan({ 'pokeapi.attempts': attemptNumber });

      const payload = yield* decodePayload(body).pipe(
        Effect.tapError((error) => rejectContract('payload', name, error.message)),
        Effect.mapError((error) => invalidResponse(`Unexpected PokeAPI payload: ${error.message}`)),
      );
      return yield* decodePokemon(toPokemonInput(payload)).pipe(
        Effect.tapError((error) => rejectContract('domain', name, error.message)),
        Effect.mapError((error) => invalidResponse(`PokeAPI payload violates domain rules: ${error.message}`)),
      );
    });

    return PokemonCatalog.of({ findByName });
  }),
);

/** An upstream contract break is always worth an error log: it needs a human. */
const rejectContract = (stage: 'payload' | 'domain', name: PokemonName, message: string) =>
  Effect.gen(function* () {
    yield* count(contractViolations, { stage });
    yield* Effect.logError('PokeAPI payload rejected').pipe(
      Effect.annotateLogs({ 'pokemon.name': name, stage, 'error': message }),
    );
  });
