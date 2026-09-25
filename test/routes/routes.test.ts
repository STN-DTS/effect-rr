import { data as routerData } from 'react-router';
import type { UNSAFE_DataWithResponseInit as DataWithResponseInit } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as home from '~/routes/home.tsx';
import * as pokemonRoute from '~/routes/pokemon.tsx';

import { makeTestRuntime, UNAVAILABLE_CATALOG } from '../support/app.ts';
import { callRoute, thrown } from '../support/router.ts';

// The class behind `data(...)` is not exported as a value; grab its constructor.
const DataWithResponseInitClass = routerData(null).constructor;

let runtime: ReturnType<typeof makeTestRuntime>;
beforeEach(() => {
  runtime = makeTestRuntime();
});
afterEach(() => runtime.dispose());

const detailOn = (on: typeof runtime, name: string) =>
  callRoute(pokemonRoute.loader, on, `/pokemon/${encodeURIComponent(name)}`, { name });
const detail = (name: string) => detailOn(runtime, name);
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
          { key: 'hp', label: 'HP', value: 35 },
          { key: 'attack', label: 'Attack', value: 55 },
          { key: 'defense', label: 'Defense', value: 40 },
          { key: 'special-attack', label: 'Sp. Atk', value: 50 },
          { key: 'special-defense', label: 'Sp. Def', value: 50 },
          { key: 'speed', label: 'Speed', value: 90 },
        ],
        baseStatTotal: 320,
        artworkUrl: 'http://127.0.0.1:4010/sprites/sprites/pokemon/other/official-artwork/25.png',
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

  it('redirects a dex number to the canonical URL of its default form', async () => {
    const response = (await detail('386')) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/pokemon/deoxys-normal');
  });

  it('throws 503 when the catalog is unavailable', async () => {
    const unavailable = makeTestRuntime(UNAVAILABLE_CATALOG);
    try {
      await expectThrownData(detailOn(unavailable, 'pikachu'), 503);
    } finally {
      await unavailable.dispose();
    }
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
