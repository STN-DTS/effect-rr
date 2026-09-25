import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so unit tests don't boot the React Router plugin.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
});
