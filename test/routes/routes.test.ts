import { data as routerData, isRouteErrorResponse } from 'react-router';
import type { UNSAFE_DataWithResponseInit as DataWithResponseInit } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as home from '~/routes/home.tsx';
import * as pokemonRoute from '~/routes/pokemon.tsx';

import { DEFECT_NAME, UNAVAILABLE_NAME } from '../support/fakes.ts';
import { bulbasaur, pikachu } from '../support/pokemon.ts';
import { callRoute, makeTestRuntime, thrown } from '../support/router.ts';

// The class behind `data(...)` is not exported as a value; grab its constructor.
const DataWithResponseInitClass = routerData(null).constructor;

let runtime: ReturnType<typeof makeTestRuntime>;
beforeEach(() => {
  runtime = makeTestRuntime([pikachu, bulbasaur]);
});
afterEach(() => runtime.dispose());

const detail = (name: string) => callRoute(pokemonRoute.loader, runtime, `/pokemon/${encodeURIComponent(name)}`, { name });
const homePage = (query = '') => callRoute(home.loader, runtime, `/${query}`, {});

/** Thrown `data(...)` values become ErrorResponses; assert on status + payload. */
const expectThrownData = async (promise: Promise<unknown>, status: number) => {
  const error = await thrown(promise);
  expect(error).toBeInstanceOf(DataWithResponseInitClass);
  const { init, data } = error as DataWithResponseInit<{ message: string }>;
  expect(init?.status).toBe(status);
  return data;
};

describe('/pokemon/:name loader', () => {
  it('returns a plain, serializable DTO', async () => {
    const result = await detail('pikachu');
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toEqual({
      pokemon: {
        name: 'pikachu',
        displayName: 'Pikachu',
        dexNumber: 25,
        types: ['electric'],
        heightMetres: 0.4,
        weightKilograms: 6,
        stats: [
          { key: 'hp', label: 'HP', value: 50 },
          { key: 'attack', label: 'Attack', value: 50 },
          { key: 'defense', label: 'Defense', value: 50 },
          { key: 'special-attack', label: 'Sp. Atk', value: 50 },
          { key: 'special-defense', label: 'Sp. Def', value: 50 },
          { key: 'speed', label: 'Speed', value: 50 },
        ],
        baseStatTotal: 300,
        artworkUrl: 'https://img.example/25.png',
      },
    });
    // Survives a JSON round trip unchanged: no classes, Options or brands leak out.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('redirects non-canonical names to the canonical URL', async () => {
    const result = await detail('Pikachu');
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/pokemon/pikachu');
  });

  it('throws 404 for an unknown Pokémon', async () => {
    const data = await expectThrownData(detail('missingno'), 404);
    expect(data.message).toContain('missingno');
  });

  it('throws 400 for an invalid name', async () => {
    await expectThrownData(detail('pika$chu'), 400);
  });

  it('throws 503 when the catalog is unavailable', async () => {
    await expectThrownData(detail(UNAVAILABLE_NAME), 503);
  });

  it('records the view in the recently viewed list', async () => {
    await detail('bulbasaur');
    await detail('pikachu');
    const page = await homePage();
    expect(page).toMatchObject({
      recentlyViewed: [
        { name: 'pikachu', displayName: 'Pikachu', dexNumber: 25 },
        { name: 'bulbasaur', displayName: 'Bulbasaur', dexNumber: 1 },
      ],
    });
  });
});

describe('/ loader', () => {
  it('renders an empty search and history', async () => {
    expect(await homePage()).toEqual({ recentlyViewed: [], search: { value: '', error: null } });
  });

  it('redirects a valid search to the normalized detail page', async () => {
    const result = (await homePage('?name=%20Mr%20Mime%20')) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/pokemon/mr-mime');
  });

  it.each([
    ['', 'Enter a Pokémon name.'],
    ['pika%24chu', 'Use only letters, digits and single hyphens.'],
    ['a'.repeat(41), 'Names are at most 40 characters.'],
  ])('answers 400 with a field error for name=%s', async (raw, message) => {
    const result = await homePage(`?name=${raw}`);
    expect(result).toBeInstanceOf(DataWithResponseInitClass);
    const { init, data } = result as DataWithResponseInit<unknown>;
    expect(init?.status).toBe(400);
    expect(data).toEqual({
      recentlyViewed: [],
      search: { value: decodeURIComponent(raw), error: message },
    });
  });
});

describe('/ action', () => {
  const post = (body: Record<string, string>) =>
    callRoute(home.action, runtime, '/', {}, { method: 'POST', body: new URLSearchParams(body) });

  it('clears the list and redirects back home', async () => {
    await detail('pikachu');
    const response = await post({ intent: 'clear' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    expect(await homePage()).toMatchObject({ recentlyViewed: [] });
  });

  it('rejects unknown intents with 400', async () => {
    await expectThrownData(post({ intent: 'explode' }), 400);
  });
});

describe('bridge', () => {
  it('lets defects reject (→ 500 via ErrorBoundary) instead of mapping them', async () => {
    const error = await thrown(detail(DEFECT_NAME));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('fake catalog bug');
    expect(isRouteErrorResponse(error)).toBe(false);
    expect(error).not.toBeInstanceOf(DataWithResponseInitClass);
  });
});
