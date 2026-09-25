import { defineConfig, devices } from '@playwright/test';

const STUB_PORT = 4010;
const HTTP_APP_PORT = 3100; // POKEMON_CATALOG=http, pointed at the PokeAPI stub
const IN_MEMORY_APP_PORT = 3101; // default adapter (in-memory dataset)

const common = {
  HOST: '127.0.0.1',
  LOG_FORMAT: 'logfmt',
  // Ignore any developer `.env`: the e2e servers are configured only by what's below.
  DOTENV_PATH: '',
  // No telemetry export: keeps the servers off the network (and off a developer's collector).
  OTEL_SDK_DISABLED: 'true',
};

export default defineConfig({
  testDir: './e2e',
  // The app keeps one in-memory "recently viewed" list per process, so specs run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'http-adapter',
      testMatch: 'pokedex.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${HTTP_APP_PORT}` },
    },
    {
      name: 'in-memory-adapter',
      testMatch: 'in-memory.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${IN_MEMORY_APP_PORT}` },
    },
  ],
  // Started in order; always the production build, never the dev server.
  webServer: [
    {
      command: 'node e2e/stub-pokeapi.ts',
      url: `http://127.0.0.1:${STUB_PORT}/health`,
      env: { STUB_PORT: String(STUB_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'pnpm build && pnpm start',
      url: `http://127.0.0.1:${HTTP_APP_PORT}/healthz`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ...common,
        PORT: String(HTTP_APP_PORT),
        POKEMON_CATALOG: 'http',
        POKEAPI_BASE_URL: `http://127.0.0.1:${STUB_PORT}/api/v2`,
        POKEAPI_TIMEOUT: '1 second',
        POKEAPI_RETRIES: '1',
      },
    },
    {
      // No POKEMON_CATALOG: exercises the default. The fixture dataset's artwork
      // URLs point at the stub, so the browser stays on 127.0.0.1.
      command: 'pnpm start',
      url: `http://127.0.0.1:${IN_MEMORY_APP_PORT}/healthz`,
      reuseExistingServer: false,
      env: {
        ...common,
        PORT: String(IN_MEMORY_APP_PORT),
        POKEMON_DATASET_PATH: 'test/fixtures/dataset/pokemon.json',
      },
    },
  ],
});
