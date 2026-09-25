import { Effect } from 'effect';
import type { RouterContextProvider } from 'react-router';
import { data, redirect } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '~/lib/effect.server.ts';
import { createAppLoadContext } from '~/lib/request.server.ts';

import { CurrentRequest } from '../../server/application/index.ts';
import { PokemonNotFound } from '../../server/domain/index.ts';
import { makeTestRuntime } from '../support/app.ts';
import { inRequest } from '../support/router.ts';

let runtime: ReturnType<typeof makeTestRuntime>;
beforeEach(() => {
  runtime = makeTestRuntime();
});
afterEach(() => runtime.dispose());

const inScope = <A>(handle: (context: RouterContextProvider) => Promise<A>) =>
  inRequest(runtime, new Request('http://localhost/', { headers: { 'x-request-id': 'test-request' } }), handle);

describe('run', () => {
  it('provides request-scoped services', async () => {
    const id = await inScope((context) =>
      run(
        context,
        Effect.gen(function* () {
          return (yield* CurrentRequest).requestId;
        }),
        { span: 'test', onError: {} },
      ),
    );
    expect(id).toBe('test-request');
  });

  it('routes typed failures through the matching handler', async () => {
    const result = await inScope((context) =>
      run(context, Effect.fail(new PokemonNotFound({ name: 'x' })), {
        span: 'test',
        onError: { PokemonNotFound: (e) => redirect(`/missing/${e.name}`) },
      }),
    );
    expect(result.headers.get('location')).toBe('/missing/x');
  });

  it('requires a handler for every tagged failure (compile-time)', async () => {
    const failing = Effect.fail(new PokemonNotFound({ name: 'x' }));
    const pending = inScope((context) =>
      // @ts-expect-error -- PokemonNotFound has no handler
      run(context, failing, { span: 'test', onError: {} }),
    );
    await expect(pending).rejects.toThrow('PokemonNotFound');
    void inScope((context) =>
      // @ts-expect-error -- handlers must return data()/redirect()/Response, not raw values
      run(context, failing, { span: 't', onError: { PokemonNotFound: () => 42 } }),
    ).catch(() => {});
    void data;
  });

  it('rejects on defects', async () => {
    await expect(
      inScope((context) => run(context, Effect.die(new Error('boom')), { span: 'test', onError: {} })),
    ).rejects.toThrow('boom');
  });

  it('refuses to run outside a request scope (a wiring bug, so a 500)', async () => {
    await expect(run(createAppLoadContext(runtime), Effect.void, { span: 'test', onError: {} })).rejects.toThrow(
      'No request scope',
    );
  });
});
