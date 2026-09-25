import { defineConfig } from 'oxfmt';

export default defineConfig({
  ignorePatterns: [
    '.react-router/**',
    'build/**',
    'data/**',
    'playwright-report/**',
    'test-results/**',
    'test/fixtures/**',
    '.release-please-manifest.json',
    'CHANGELOG.md',
    'pnpm-lock.yaml',
  ],

  experimentalOperatorPosition: 'start',
  printWidth: 128,
  quoteProps: 'consistent',
  singleQuote: true,
  sortImports: true,
  sortTailwindcss: true,
});
