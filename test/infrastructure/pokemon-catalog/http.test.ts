import { assert, describe, it } from '@effect/vitest';
import { ConfigProvider, Effect, Fiber, Layer, Option, Ref } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/unstable/http';

import { PokemonCatalog } from '../../../server/application/index.ts';
import { PokemonName } from '../../../server/domain/index.ts';
import { PokeApiCatalogLayer } from '../../../server/infrastructure/pokemon-catalog/http/index.ts';
import { fixture } from '../../support/fixtures.ts';

type Reply = { readonly status: number; readonly body?: string } | 'hang' | 'network-error';

/**
 * Fake HttpClient: answers each request with the next scripted reply (the
 * last one repeats) and records requested URLs.
 */
const fakeHttp = (replies: ReadonlyArray<Reply>) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([]);
    const client = HttpClient.make((request, url) =>
      Effect.gen(function* () {
        const seen = yield* Ref.updateAndGet(calls, (urls) => [...urls, url.href]);
        const reply = replies[Math.min(seen.length, replies.length) - 1]!;

        if (reply === 'hang') {
          return yield* Effect.never;
        }

        if (reply === 'network-error') {
          return yield* new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: 'ECONNRESET' }),
          });
        }

        return HttpClientResponse.fromWeb(
          request,
          new Response(reply.body ?? null, {
            status: reply.status,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );
    return { calls, layer: Layer.succeed(HttpClient.HttpClient, client) };
  });

const config = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    POKEAPI_BASE_URL: 'http://pokeapi.test/api/v2/',
    POKEAPI_TIMEOUT: '1 second',
    POKEAPI_RETRIES: '2',
  }),
);

/** Runs `findByName(name)` against the adapter wired to scripted replies. */
const find = (name: string, replies: ReadonlyArray<Reply>) =>
  Effect.gen(function* () {
    const http = yield* fakeHttp(replies);
    const result = yield* Effect.gen(function* () {
      const catalog = yield* PokemonCatalog;
      return yield* Effect.result(catalog.findByName(PokemonName.make(name)));
    }).pipe(Effect.provide(PokeApiCatalogLayer.pipe(Layer.provide([http.layer, config]))));
    return { result, calls: yield* Ref.get(http.calls) };
  });

const ok = (name: string): Reply => ({ status: 200, body: fixture(name) });

describe('PokeApiCatalog', () => {
  it.effect('decodes a recorded payload into the domain aggregate', () =>
    Effect.gen(function* () {
      const { result, calls } = yield* find('pikachu', [ok('pikachu')]);
      assert.deepStrictEqual(calls, ['http://pokeapi.test/api/v2/pokemon/pikachu']);
      assert.isTrue(result._tag === 'Success');

      if (result._tag !== 'Success') {
        return;
      }

      const pokemon = result.success;
      assert.strictEqual(pokemon.name, 'pikachu');
      assert.strictEqual(pokemon.dexNumber, 25);
      assert.deepStrictEqual(pokemon.types, ['electric']);
      assert.strictEqual(pokemon.height, 4);
      assert.strictEqual(pokemon.weight, 60);
      assert.deepStrictEqual(
        pokemon.baseStats.map((s) => [s.stat, s.value]),
        [
          ['hp', 35],
          ['attack', 55],
          ['defense', 40],
          ['special-attack', 50],
          ['special-defense', 50],
          ['speed', 90],
        ],
      );
      assert.isTrue(Option.isSome(pokemon.artworkUrl));
    }),
  );

  it.effect('orders dual types by slot', () =>
    Effect.gen(function* () {
      const { result } = yield* find('charizard', [ok('charizard')]);
      assert.isTrue(result._tag === 'Success');

      if (result._tag === 'Success') {
        assert.deepStrictEqual(result.success.types, ['fire', 'flying']);
      }
    }),
  );

  it.effect('maps 404 to PokemonNotFound without retrying', () =>
    Effect.gen(function* () {
      const { result, calls } = yield* find('missingno', [{ status: 404, body: 'Not Found' }]);
      assert.strictEqual(calls.length, 1);
      assert.isTrue(result._tag === 'Failure' && result.failure._tag === 'PokemonNotFound');
    }),
  );

  it.effect('retries 5xx and recovers when the upstream comes back', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(find('pikachu', [{ status: 503 }, ok('pikachu')]));
      yield* TestClock.adjust('1 second');
      const { result, calls } = yield* Fiber.join(fiber);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(result._tag, 'Success');
    }),
  );

  it.effect('maps persistent 5xx to CatalogUnavailable after the configured retries', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(find('pikachu', [{ status: 500 }]));
      yield* TestClock.adjust('10 seconds');
      const { result, calls } = yield* Fiber.join(fiber);
      assert.strictEqual(calls.length, 3);
      assert.isTrue(result._tag === 'Failure');

      if (result._tag !== 'Failure') {
        return;
      }

      assert.strictEqual(result.failure._tag, 'CatalogUnavailable');

      if (result.failure._tag === 'CatalogUnavailable') {
        assert.strictEqual(result.failure.reason, 'UpstreamFailure');
      }
    }),
  );

  it.effect('maps network errors to CatalogUnavailable after retries', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(find('pikachu', ['network-error']));
      yield* TestClock.adjust('10 seconds');
      const { result, calls } = yield* Fiber.join(fiber);
      assert.strictEqual(calls.length, 3);
      assert.isTrue(result._tag === 'Failure' && result.failure._tag === 'CatalogUnavailable');
    }),
  );

  it.effect('times out each attempt and reports Timeout', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(find('pikachu', ['hang']));
      yield* TestClock.adjust('30 seconds');
      const { result, calls } = yield* Fiber.join(fiber);
      assert.strictEqual(calls.length, 3);
      assert.isTrue(result._tag === 'Failure');
      if (result._tag === 'Failure' && result.failure._tag === 'CatalogUnavailable') {
        assert.strictEqual(result.failure.reason, 'Timeout');
      } else {
        assert.fail('expected CatalogUnavailable');
      }
    }),
  );

  it.effect('does not retry non-transient 4xx', () =>
    Effect.gen(function* () {
      const { result, calls } = yield* find('pikachu', [{ status: 400 }]);
      assert.strictEqual(calls.length, 1);
      assert.isTrue(result._tag === 'Failure' && result.failure._tag === 'CatalogUnavailable');
    }),
  );

  it.effect.each([
    { label: 'missing fields', body: fixture('malformed') },
    { label: 'invalid JSON', body: '{not json' },
    { label: 'domain violation', body: fixture('pikachu').replace('"electric"', '"shadow"') },
  ])('maps a malformed payload ($label) to CatalogUnavailable(InvalidResponse)', ({ body }) =>
    Effect.gen(function* () {
      const { result, calls } = yield* find('pikachu', [{ status: 200, body }]);
      assert.strictEqual(calls.length, 1);
      if (result._tag === 'Failure' && result.failure._tag === 'CatalogUnavailable') {
        assert.strictEqual(result.failure.reason, 'InvalidResponse');
      } else {
        assert.fail('expected CatalogUnavailable(InvalidResponse)');
      }
    }),
  );
});
