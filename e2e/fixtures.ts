import { test as base, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/**
 * Every page gets a network guard: any request leaving 127.0.0.1 is aborted
 * and fails the test, so e2e can never reach the real PokeAPI (or its CDN).
 */
export const test = base.extend<{ networkGuard: void }>({
  networkGuard: [
    async ({ page }, use) => {
      const escaped: string[] = [];
      await page.route(/^(?!https?:\/\/127\.0\.0\.1[:/]).*/, async (route) => {
        escaped.push(route.request().url());
        await route.abort('blockedbyclient');
      });
      await use();
      expect(escaped, 'requests to external hosts').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Resets the server's in-memory "recently viewed" list. */
export const clearRecentlyViewed = async (request: APIRequestContext) => {
  const response = await request.post('/?index', { form: { intent: 'clear' }, maxRedirects: 0 });
  expect(response.status()).toBe(302);
};
