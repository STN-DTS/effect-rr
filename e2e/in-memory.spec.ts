import { clearRecentlyViewed, expect, test } from './fixtures.ts';

// Runs against a server started with the default adapter (POKEMON_CATALOG unset).

test.beforeEach(async ({ request }) => {
  await clearRecentlyViewed(request);
});

test('search is served from the in-memory dataset', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Pokémon name or number').fill('Charizard');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page).toHaveURL('/pokemon/charizard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Charizard');
  await expect(page.getByRole('list', { name: 'Types' })).toHaveText('fireflying');
  await expect(page.getByRole('img', { name: 'Official artwork of Charizard' })).toBeVisible();
});

test("dex numbers resolve to the default form's canonical URL", async ({ page }) => {
  await page.goto('/?name=386');
  await expect(page).toHaveURL('/pokemon/deoxys-normal');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Deoxys Normal');
});

test('names missing from the dataset are 404s', async ({ page }) => {
  const response = await page.goto('/pokemon/missingno');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pokémon not found');
});
