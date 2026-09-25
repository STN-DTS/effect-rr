import { clearRecentlyViewed, expect, test } from './fixtures.ts';

test.beforeEach(async ({ request }) => {
  await clearRecentlyViewed(request);
});

test('search leads to the detail page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Pokémon name or number').fill('  Pikachu ');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page).toHaveURL('/pokemon/pikachu');
  await expect(page).toHaveTitle('Pikachu · Pokédex');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pikachu');
  await expect(page.getByText('#0025')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Types' })).toHaveText('electric');
  await expect(page.getByText('0.4 m')).toBeVisible();
  await expect(page.getByText('6.0 kg')).toBeVisible();
  await expect(page.getByRole('row', { name: /Speed/ })).toContainText('90');
  await expect(page.getByRole('img', { name: 'Official artwork of Pikachu' })).toBeVisible();
});

test('an unknown Pokémon renders the 404 page', async ({ page }) => {
  const response = await page.goto('/pokemon/missingno');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pokémon not found');
  await expect(page.getByText('There is no Pokémon called “missingno”.')).toBeVisible();
});

test('invalid input shows a field error with a 400', async ({ page }) => {
  const response = await page.goto('/?name=pika%24chu');
  expect(response?.status()).toBe(400);
  const input = page.getByLabel('Pokémon name or number');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveValue('pika$chu');
  await expect(page.getByRole('alert')).toHaveText('Use only letters, digits and single hyphens.');

  // Same via the form, with client-side navigation.
  await input.fill('');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a Pokémon name.');
});

test('upstream failures render a 503 page', async ({ page }) => {
  const response = await page.goto('/pokemon/outage');
  expect(response?.status()).toBe(503);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pokédex unavailable');
});

test('a malformed upstream payload renders a 502 page', async ({ page }) => {
  const response = await page.goto('/pokemon/malformed');
  expect(response?.status()).toBe(502);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pokédex unavailable');
});

test('recently viewed updates and clears', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Nothing yet')).toBeVisible();

  for (const name of ['bulbasaur', 'charizard', 'pikachu', 'bulbasaur']) {
    await page.goto(`/pokemon/${name}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await page.goto('/');
  const recent = page.getByRole('list', { name: 'Recently viewed Pokémon' });
  await expect(recent.getByRole('listitem')).toHaveText([/Bulbasaur\s+#0001/, /Pikachu\s+#0025/, /Charizard\s+#0006/]);

  await recent.getByRole('link', { name: 'Pikachu' }).click();
  await expect(page).toHaveURL('/pokemon/pikachu');
  await page.getByRole('link', { name: 'Pokédex' }).click();
  await expect(recent.getByRole('listitem').first()).toContainText('Pikachu');

  await page.getByRole('button', { name: 'Clear list' }).click();
  await expect(page.getByText('Nothing yet')).toBeVisible();
  await expect(page).toHaveURL('/');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the search form and clear button still work', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Pokémon name or number').fill('Mr Mime');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL('/pokemon/mr-mime');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mr Mime');

    await page.goto('/');
    await page.getByLabel('Pokémon name or number').fill('bad name!');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('alert')).toHaveText('Use only letters, digits and single hyphens.');

    await page.getByRole('button', { name: 'Clear list' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Nothing yet')).toBeVisible();
  });
});
